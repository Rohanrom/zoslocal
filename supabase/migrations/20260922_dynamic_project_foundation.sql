-- =====================================================================
-- ZOS Dynamic Project Foundation
-- Keeps Project Setup registry and indr.project_master aligned so newly
-- created projects can immediately use common project-scoped modules.
-- =====================================================================

begin;

-- Backfill any projects that were created in Project Setup before the
-- application started writing project_master in the same transaction.
insert into indr.project_master as pm (
  project_id,
  project_name,
  project_code,
  status
)
select
  r.project_id,
  r.project_name,
  upper(replace(r.project_id, '_', '-')) as project_code,
  'Active' as status
from public.zos_project_registry r
on conflict (project_id)
do update set
  project_name = excluded.project_name,
  project_code = coalesce(
    nullif(trim(pm.project_code), ''),
    excluded.project_code
  ),
  status = coalesce(
    nullif(trim(pm.status), ''),
    excluded.status
  );

commit;

-- Verification
select
  r.project_id,
  r.project_name as registry_name,
  pm.project_name as master_name,
  pm.project_code,
  pm.status
from public.zos_project_registry r
left join indr.project_master pm
  on pm.project_id = r.project_id
order by r.project_name, r.project_id;
