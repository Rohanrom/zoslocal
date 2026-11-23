WITH backend_done AS (
  SELECT
    assignment_v_backend_done_wall.application,
    assignment_v_backend_done_wall.flat_id,
    assignment_v_backend_done_wall.layer_id,
    assignment_v_backend_done_wall.layer_name,
    assignment_v_backend_done_wall.wall_name,
    sum(assignment_v_backend_done_wall.done_area) AS done_area
  FROM
    indr.assignment_v_backend_done_wall
  GROUP BY
    assignment_v_backend_done_wall.application,
    assignment_v_backend_done_wall.flat_id,
    assignment_v_backend_done_wall.layer_id,
    assignment_v_backend_done_wall.layer_name,
    assignment_v_backend_done_wall.wall_name
),
assigned_today AS (
  SELECT
    fa.assignment_id,
    fa.application,
    fa.flat,
    fa.layer_id,
    fa.layer_name,
    faw.wall_name,
    faw.assigned_area
  FROM
    (
      indr.final_assignment fa
      JOIN indr.final_assignment_wall faw ON ((faw.assignment_id = fa.assignment_id))
    )
  WHERE
    (
      (fa.assignment_date = CURRENT_DATE)
      AND (
        indr.norm_text(fa.status) = ANY (
          ARRAY ['PUBLISHED'::text, 'PARTIAL'::text, 'ROLLOVER'::text]
        )
      )
    )
)
SELECT
  COALESCE(sw.block, l.block) AS block,
  l.application,
  l.flat_id AS flat,
  l.layer_id,
  l.layer_name,
  l."order" AS layer_order,
  sw.surface_type,
  sw.wall_name,
  sw.wall_area,
  COALESCE(bd.done_area, (0) :: numeric) AS already_done_area,
  GREATEST(
    (
      COALESCE(sw.wall_area, (0) :: numeric) - COALESCE(bd.done_area, (0) :: numeric)
    ),
    (0) :: numeric
  ) AS pending_area,
  CASE
    WHEN (at.assignment_id IS NOT NULL) THEN TRUE
    ELSE false
  END AS is_assigned_today,
  at.assignment_id AS assigned_today_assignment_id,
  COALESCE(at.assigned_area, (0) :: numeric) AS assigned_today_area
FROM
  (
    (
      (
        indr.layer l
        JOIN indr.assignment_v_surface_wall sw ON (
          (
            (
              indr.norm_text(sw.application) = indr.norm_text(l.application)
            )
            AND (
              indr.norm_text(sw.flat_id) = indr.norm_text(l.flat_id)
            )
          )
        )
      )
      LEFT JOIN backend_done bd ON (
        (
          (
            indr.norm_text(bd.application) = indr.norm_text(l.application)
          )
          AND (
            indr.norm_text(bd.flat_id) = indr.norm_text(l.flat_id)
          )
          AND (
            indr.norm_text(bd.wall_name) = indr.norm_text(sw.wall_name)
          )
          AND (
            (
              indr.norm_text(bd.layer_id) = indr.norm_text(l.layer_id)
            )
            OR (
              indr.norm_text(bd.layer_name) = indr.norm_text(l.layer_name)
            )
          )
        )
      )
    )
    LEFT JOIN assigned_today at ON (
      (
        (
          indr.norm_text(at.application) = indr.norm_text(l.application)
        )
        AND (
          indr.norm_text(at.flat) = indr.norm_text(l.flat_id)
        )
        AND (
          (
            indr.norm_text(at.layer_id) = indr.norm_text(l.layer_id)
          )
          OR (
            indr.norm_text(at.layer_name) = indr.norm_text(l.layer_name)
          )
        )
        AND (
          indr.norm_text(at.wall_name) = indr.norm_text(sw.wall_name)
        )
      )
    )
  )
WHERE
  (
    GREATEST(
      (
        COALESCE(sw.wall_area, (0) :: numeric) - COALESCE(bd.done_area, (0) :: numeric)
      ),
      (0) :: numeric
    ) > (0) :: numeric
  )
ORDER BY
  COALESCE(sw.block, l.block),
  l.application,
  l.flat_id,
  l."order",
  sw.wall_name;