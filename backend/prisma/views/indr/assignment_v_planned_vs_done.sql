WITH backend_done AS (
  SELECT
    fa_1.assignment_id,
    sum(COALESCE(bd_1.done_area, (0) :: numeric)) AS actual_area_done,
    sum(COALESCE(bd_1.working_hours, (0) :: numeric)) AS actual_hours
  FROM
    (
      (
        indr.final_assignment fa_1
        JOIN indr.final_assignment_wall faw ON ((faw.assignment_id = fa_1.assignment_id))
      )
      LEFT JOIN indr.assignment_v_backend_done_wall bd_1 ON (
        (
          (
            indr.norm_text(bd_1.application) = indr.norm_text(fa_1.application)
          )
          AND (
            (
              indr.norm_text(bd_1.flat_id) = indr.norm_text(fa_1.flat)
            )
            OR (
              indr.norm_text(bd_1.flat) = indr.norm_text(fa_1.flat)
            )
          )
          AND (
            indr.norm_text(bd_1.wall_name) = indr.norm_text(faw.wall_name)
          )
          AND (
            (
              indr.norm_text(bd_1.layer_id) = indr.norm_text(fa_1.layer_id)
            )
            OR (
              indr.norm_text(bd_1.layer_name) = indr.norm_text(fa_1.layer_name)
            )
          )
          AND (bd_1.work_date = fa_1.assignment_date)
        )
      )
    )
  GROUP BY
    fa_1.assignment_id
)
SELECT
  fa.assignment_id,
  fa.assignment_date,
  fa.block,
  fa.application,
  fa.flat,
  fa.layer_id,
  fa.layer_name,
  fa.surface_type,
  fa.assigned_area,
  COALESCE(bd.actual_area_done, (0) :: numeric) AS actual_area_done,
  GREATEST(
    (
      COALESCE(fa.assigned_area, (0) :: numeric) - COALESCE(bd.actual_area_done, (0) :: numeric)
    ),
    (0) :: numeric
  ) AS remaining_area,
  fa.expected_hours,
  COALESCE(bd.actual_hours, (0) :: numeric) AS actual_hours,
  round(
    CASE
      WHEN (
        COALESCE(fa.assigned_area, (0) :: numeric) > (0) :: numeric
      ) THEN (
        (
          COALESCE(bd.actual_area_done, (0) :: numeric) / fa.assigned_area
        ) * (100) :: numeric
      )
      ELSE (0) :: numeric
    END,
    2
  ) AS completion_percent,
  (
    COALESCE(bd.actual_area_done, (0) :: numeric) - COALESCE(fa.assigned_area, (0) :: numeric)
  ) AS variance_area,
  CASE
    WHEN (
      COALESCE(bd.actual_area_done, (0) :: numeric) = (0) :: numeric
    ) THEN 'Not Reported' :: text
    WHEN (
      COALESCE(bd.actual_area_done, (0) :: numeric) < COALESCE(fa.assigned_area, (0) :: numeric)
    ) THEN 'Partially Done' :: text
    WHEN (
      COALESCE(bd.actual_area_done, (0) :: numeric) = COALESCE(fa.assigned_area, (0) :: numeric)
    ) THEN 'Fully Done' :: text
    WHEN (
      COALESCE(bd.actual_area_done, (0) :: numeric) > COALESCE(fa.assigned_area, (0) :: numeric)
    ) THEN 'Extra Work Reported' :: text
    ELSE 'Unknown' :: text
  END AS outcome_status
FROM
  (
    indr.final_assignment fa
    LEFT JOIN backend_done bd ON ((bd.assignment_id = fa.assignment_id))
  );