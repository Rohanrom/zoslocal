WITH assigned_wall AS (
  SELECT
    fa.assignment_id,
    fa.run_id,
    fa.assignment_date,
    fa.block,
    fa.application,
    fa.flat,
    fa.layer_id,
    fa.layer_name,
    fa.surface_type,
    fa.machine_or_manual,
    fa.status AS assignment_status,
    faw.wall_name,
    COALESCE(
      NULLIF(faw.assigned_area, (0) :: numeric),
      NULLIF(faw.wall_area, (0) :: numeric),
      (0) :: numeric
    ) AS wall_assigned_area,
    COALESCE(faw.wall_status, 'Assigned' :: text) AS wall_status
  FROM
    (
      indr.final_assignment fa
      JOIN indr.final_assignment_wall faw ON ((faw.assignment_id = fa.assignment_id))
    )
  WHERE
    (
      (
        indr.norm_text(COALESCE(fa.status, '' :: text)) <> ALL (
          ARRAY ['REPLACED'::text, 'CANCELLED'::text, 'REMOVED'::text]
        )
      )
      AND (
        indr.norm_text(COALESCE(faw.wall_status, '' :: text)) <> ALL (
          ARRAY ['REPLACED'::text, 'CANCELLED'::text, 'REMOVED'::text]
        )
      )
    )
)
SELECT
  assignment_id,
  run_id,
  assignment_date,
  block,
  application,
  flat,
  layer_id,
  layer_name,
  surface_type,
  machine_or_manual,
  assignment_status,
  string_agg(
    wall_name,
    ', ' :: text
    ORDER BY
      wall_name
  ) AS wall_names,
  (count(*)) :: integer AS wall_count,
  sum(wall_assigned_area) AS assigned_area,
  COALESCE(
    indr.assignment_get_productivity_per_hour(application, layer_name, machine_or_manual),
    (0) :: numeric
  ) AS productivity_per_hour,
  CASE
    WHEN (
      COALESCE(
        indr.assignment_get_productivity_per_hour(application, layer_name, machine_or_manual),
        (0) :: numeric
      ) > (0) :: numeric
    ) THEN round(
      (
        sum(wall_assigned_area) / indr.assignment_get_productivity_per_hour(application, layer_name, machine_or_manual)
      ),
      2
    )
    ELSE (0) :: numeric
  END AS expected_hours
FROM
  assigned_wall
GROUP BY
  assignment_id,
  run_id,
  assignment_date,
  block,
  application,
  flat,
  layer_id,
  layer_name,
  surface_type,
  machine_or_manual,
  assignment_status;