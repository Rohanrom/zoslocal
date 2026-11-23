-- =====================================================================
-- Project-scope indexes
--
-- Every project page filters by project_id, but none of the hot tables
-- has an index that starts with project_id. Postgres therefore scans the
-- whole table for each project on:
--   GET /projects            (8 count(*) sub-queries per project)
--   GET /projection/home-layer-progress
--   dimensions, BOQ, costing and analytics reads
--
-- These tables and columns were added to production outside this
-- migrations folder, so each index is created only when its table and
-- columns exist. Running this file twice is safe.
--
-- Plain CREATE INDEX briefly blocks writes on each table while it builds.
-- Run it outside working hours. On a very large table, build that one index
-- by hand with CREATE INDEX CONCURRENTLY instead (it cannot run inside a
-- migration transaction).
-- =====================================================================

do $$
declare
  spec record;
  missing_cols int;
begin
  for spec in
    select * from (values
      -- schema, table, index name, columns (as written in CREATE INDEX)
      ('indr',   'layer',                      'idx_layer_project',                  array['project_id'],                         'project_id'),
      ('indr',   'surface_number',             'idx_surface_number_project',         array['project_id'],                         'project_id'),
      ('indr',   'flat_area_summary',          'idx_flat_area_summary_project',      array['project_id'],                         'project_id'),
      ('indr',   'material_master',            'idx_material_master_project',        array['project_id'],                         'project_id'),
      ('indr',   'productivity_master',        'idx_productivity_master_project',    array['project_id'],                         'project_id'),
      ('indr',   'project_flat_layer_costing', 'idx_pflc_project',                   array['project_id'],                         'project_id'),
      ('indr',   'backend',                    'idx_backend_project_date',           array['project_id', 'work_date'],            'project_id, work_date'),
      ('public', 'boq',                        'idx_boq_project',                    array['project_id'],                         'project_id'),
      -- Home layer progress joins layer to flat_area_summary on these
      -- normalised expressions; this index lets that join use an index.
      ('indr',   'flat_area_summary',          'idx_flat_area_summary_project_app_flat',
        array['project_id', 'application', 'flat_id'],
        'project_id, upper(trim(coalesce(application, ''''))), upper(trim(coalesce(flat_id, '''')))')
    ) as t(schema_name, table_name, index_name, required_cols, index_expr)
  loop
    if to_regclass(format('%I.%I', spec.schema_name, spec.table_name)) is null then
      raise notice 'skip %: table %.% not found', spec.index_name, spec.schema_name, spec.table_name;
      continue;
    end if;

    select count(*) into missing_cols
    from unnest(spec.required_cols) as c(col)
    where not exists (
      select 1
      from information_schema.columns ic
      where ic.table_schema = spec.schema_name
        and ic.table_name = spec.table_name
        and ic.column_name = c.col
    );

    if missing_cols > 0 then
      raise notice 'skip %: % column(s) missing on %.%',
        spec.index_name, missing_cols, spec.schema_name, spec.table_name;
      continue;
    end if;

    execute format(
      'create index if not exists %I on %I.%I (%s)',
      spec.index_name, spec.schema_name, spec.table_name, spec.index_expr
    );
    raise notice 'ok   %', spec.index_name;
  end loop;
end
$$;

-- Refresh planner statistics so the new indexes are used straight away.
do $$
declare
  t text;
begin
  foreach t in array array[
    'indr.layer', 'indr.surface_number', 'indr.flat_area_summary',
    'indr.material_master', 'indr.productivity_master',
    'indr.project_flat_layer_costing', 'indr.backend', 'public.boq'
  ]
  loop
    if to_regclass(t) is not null then
      execute 'analyze ' || t;
    end if;
  end loop;
end
$$;
