WITH grouped AS (
  SELECT
    assignment_v_work_demand_wall_source.section,
    assignment_v_work_demand_wall_source.priority_rank,
    assignment_v_work_demand_wall_source.source_table,
    assignment_v_work_demand_wall_source.block,
    assignment_v_work_demand_wall_source.application,
    assignment_v_work_demand_wall_source.flat,
    assignment_v_work_demand_wall_source.layer_id,
    assignment_v_work_demand_wall_source.layer_name,
    assignment_v_work_demand_wall_source.surface_type,
    assignment_v_work_demand_wall_source.layer_order,
    assignment_v_work_demand_wall_source.billable,
    bool_or(
      assignment_v_work_demand_wall_source.is_hour_based
    ) AS is_hour_based,
    CASE
      WHEN bool_or(
        assignment_v_work_demand_wall_source.is_hour_based
      ) THEN 0
      ELSE (count(*)) :: integer
    END AS wall_count,
    CASE
      WHEN bool_or(
        assignment_v_work_demand_wall_source.is_hour_based
      ) THEN NULL :: text
      ELSE string_agg(
        assignment_v_work_demand_wall_source.wall_name,
        ', ' :: text
        ORDER BY
          assignment_v_work_demand_wall_source.wall_name
      )
    END AS wall_names,
    sum(
      assignment_v_work_demand_wall_source.remaining_area
    ) AS remaining_area,
    min(assignment_v_work_demand_wall_source.oldest_date) AS oldest_date,
    min(
      assignment_v_work_demand_wall_source.eligibility_status
    ) AS base_eligibility_status,
    min(assignment_v_work_demand_wall_source.risk_reason) AS base_risk_reason,
    max(assignment_v_work_demand_wall_source.total_hours) AS total_hours,
    max(
      assignment_v_work_demand_wall_source.reported_hours
    ) AS reported_hours,
    max(
      assignment_v_work_demand_wall_source.remaining_hours
    ) AS remaining_hours
  FROM
    indr.assignment_v_work_demand_wall_source
  WHERE
    (
      COALESCE(
        assignment_v_work_demand_wall_source.remaining_area,
        (0) :: numeric
      ) > (0) :: numeric
    )
  GROUP BY
    assignment_v_work_demand_wall_source.section,
    assignment_v_work_demand_wall_source.priority_rank,
    assignment_v_work_demand_wall_source.source_table,
    assignment_v_work_demand_wall_source.block,
    assignment_v_work_demand_wall_source.application,
    assignment_v_work_demand_wall_source.flat,
    assignment_v_work_demand_wall_source.layer_id,
    assignment_v_work_demand_wall_source.layer_name,
    assignment_v_work_demand_wall_source.surface_type,
    assignment_v_work_demand_wall_source.layer_order,
    assignment_v_work_demand_wall_source.billable
),
with_mode AS (
  SELECT
    g.section,
    g.priority_rank,
    g.source_table,
    g.block,
    g.application,
    g.flat,
    g.layer_id,
    g.layer_name,
    g.surface_type,
    g.layer_order,
    g.billable,
    g.is_hour_based,
    g.wall_count,
    g.wall_names,
    g.remaining_area,
    g.oldest_date,
    g.base_eligibility_status,
    g.base_risk_reason,
    g.total_hours,
    g.reported_hours,
    g.remaining_hours,
    CASE
      WHEN g.is_hour_based THEN 'Both' :: text
      ELSE indr.assignment_default_work_mode(g.layer_name)
    END AS machine_or_manual
  FROM
    grouped g
),
with_productivity AS (
  SELECT
    wm.section,
    wm.priority_rank,
    wm.source_table,
    wm.block,
    wm.application,
    wm.flat,
    wm.layer_id,
    wm.layer_name,
    wm.surface_type,
    wm.layer_order,
    wm.billable,
    wm.is_hour_based,
    wm.wall_count,
    wm.wall_names,
    wm.remaining_area,
    wm.oldest_date,
    wm.base_eligibility_status,
    wm.base_risk_reason,
    wm.total_hours,
    wm.reported_hours,
    wm.remaining_hours,
    wm.machine_or_manual,
    CASE
      WHEN wm.is_hour_based THEN (1) :: numeric
      ELSE COALESCE(
        indr.assignment_get_productivity_per_hour(
          wm.application,
          wm.layer_name,
          wm.machine_or_manual
        ),
        (0) :: numeric
      )
    END AS productivity_per_hour
  FROM
    with_mode wm
)
SELECT
  md5(
    (
      (
        (
          (
            (
              (
                (
                  (
                    (
                      (
                        (
                          (COALESCE(section, '' :: text) || '|' :: text) || COALESCE(block, '' :: text)
                        ) || '|' :: text
                      ) || COALESCE(application, '' :: text)
                    ) || '|' :: text
                  ) || COALESCE(flat, '' :: text)
                ) || '|' :: text
              ) || COALESCE(layer_id, '' :: text)
            ) || '|' :: text
          ) || COALESCE(layer_name, '' :: text)
        ) || '|' :: text
      ) || COALESCE(surface_type, '' :: text)
    )
  ) AS source_id,
  section,
  priority_rank,
  source_table,
  NULL :: text AS source_wall_id,
  block,
  application,
  flat,
  layer_id,
  layer_name,
  surface_type,
  layer_order,
  billable,
  wall_count,
  wall_names,
  remaining_area,
  machine_or_manual,
  CASE
    WHEN is_hour_based THEN 'Hour-based: Cleaning/Helping uses 24 total hours' :: text
    WHEN (machine_or_manual = 'Machine' :: text) THEN 'Default: Primer/Paint uses Machine' :: text
    ELSE 'Default: Non-primer/paint uses Both' :: text
  END AS productivity_mode_rule,
  productivity_per_hour,
  CASE
    WHEN is_hour_based THEN remaining_area
    WHEN (productivity_per_hour > (0) :: numeric) THEN round((remaining_area / productivity_per_hour), 2)
    ELSE (0) :: numeric
  END AS required_hours,
  oldest_date,
  CASE
    WHEN is_hour_based THEN 'Available' :: text
    WHEN (productivity_per_hour <= (0) :: numeric) THEN 'Missing Productivity' :: text
    ELSE COALESCE(base_eligibility_status, 'Available' :: text)
  END AS eligibility_status,
  CASE
    WHEN is_hour_based THEN NULL :: text
    WHEN (productivity_per_hour <= (0) :: numeric) THEN 'No productivity found for selected mode/application/layer' :: text
    ELSE base_risk_reason
  END AS risk_reason,
  is_hour_based,
  total_hours,
  reported_hours,
  remaining_hours
FROM
  with_productivity
ORDER BY
  priority_rank,
  oldest_date,
  application,
  flat,
  layer_order,
  layer_name,
  surface_type;