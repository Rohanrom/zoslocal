-- ZOS Analytics read cache
-- Heavy Analytics views are materialized once and read repeatedly.
-- Existing source tables/views are untouched.

create schema if not exists analytics_cache;

create materialized view if not exists analytics_cache.mv_work_performance as
select *
from public.v_project_work_performance_with_target
with data;

create materialized view if not exists analytics_cache.mv_budget_flat_layer as
select *
from public.v_project_budget_cost_control_flat_layer
with data;

create index if not exists idx_ac_work_project
on analytics_cache.mv_work_performance (project_id);

create index if not exists idx_ac_work_project_date
on analytics_cache.mv_work_performance (project_id, work_date);

create index if not exists idx_ac_work_filter_norm
on analytics_cache.mv_work_performance (
  project_id,
  indr.norm_text(block),
  indr.norm_text(application),
  indr.norm_text(flat_id),
  indr.norm_text(work_layer)
);

create index if not exists idx_ac_work_billable
on analytics_cache.mv_work_performance (project_id, is_billable);

create index if not exists idx_ac_budget_project
on analytics_cache.mv_budget_flat_layer (project_id);

create index if not exists idx_ac_budget_filter_norm
on analytics_cache.mv_budget_flat_layer (
  project_id,
  indr.norm_text(block),
  indr.norm_text(application),
  indr.norm_text(flat_id),
  indr.norm_text(work_layer)
);

create index if not exists idx_ac_budget_order
on analytics_cache.mv_budget_flat_layer (
  project_id, application, flat_id, layer_order, work_layer
);

analyze analytics_cache.mv_work_performance;
analyze analytics_cache.mv_budget_flat_layer;
