WITH surface_total AS (
  SELECT
    assignment_v_surface_wall.application,
    assignment_v_surface_wall.flat_id,
    sum(assignment_v_surface_wall.wall_area) AS total_area
  FROM
    indr.assignment_v_surface_wall
  GROUP BY
    assignment_v_surface_wall.application,
    assignment_v_surface_wall.flat_id
),
backend_done AS (
  SELECT
    assignment_v_backend_done_wall.layer_id,
    assignment_v_backend_done_wall.application,
    assignment_v_backend_done_wall.flat_id,
    assignment_v_backend_done_wall.layer_name,
    sum(assignment_v_backend_done_wall.done_area) AS done_area
  FROM
    indr.assignment_v_backend_done_wall
  GROUP BY
    assignment_v_backend_done_wall.layer_id,
    assignment_v_backend_done_wall.application,
    assignment_v_backend_done_wall.flat_id,
    assignment_v_backend_done_wall.layer_name
)
SELECT
  l.layer_id,
  l.flat_id,
  l.block,
  l.application,
  l.flat,
  l.layer_name,
  l."order" AS layer_order,
  l.billable,
  COALESCE(st.total_area, (0) :: numeric) AS total_area,
  COALESCE(bd.done_area, (0) :: numeric) AS done_area,
  round(
    CASE
      WHEN (
        COALESCE(st.total_area, (0) :: numeric) > (0) :: numeric
      ) THEN LEAST(
        (
          (
            COALESCE(bd.done_area, (0) :: numeric) / st.total_area
          ) * (100) :: numeric
        ),
        (100) :: numeric
      )
      ELSE (0) :: numeric
    END,
    2
  ) AS wkdpct
FROM
  (
    (
      indr.layer l
      LEFT JOIN surface_total st ON (
        (
          (
            indr.norm_text(st.application) = indr.norm_text(l.application)
          )
          AND (
            indr.norm_text(st.flat_id) = indr.norm_text(l.flat_id)
          )
        )
      )
    )
    LEFT JOIN backend_done bd ON (
      (
        (
          indr.norm_text(bd.layer_id) = indr.norm_text(l.layer_id)
        )
        OR (
          (
            indr.norm_text(bd.application) = indr.norm_text(l.application)
          )
          AND (
            indr.norm_text(bd.flat_id) = indr.norm_text(l.flat_id)
          )
          AND (
            indr.norm_text(bd.layer_name) = indr.norm_text(l.layer_name)
          )
        )
      )
    )
  );