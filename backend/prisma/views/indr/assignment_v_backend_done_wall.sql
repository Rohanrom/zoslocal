WITH backend_with_layer AS (
  SELECT
    b.id AS backend_id,
    COALESCE(l_id.layer_id, l_match.layer_id, b.layer_id) AS layer_id,
    b.block,
    b.application,
    COALESCE(l_id.flat_id, l_match.flat_id, b.flat) AS flat_id,
    COALESCE(l_id.flat_id, l_match.flat_id, b.flat) AS flat,
    COALESCE(
      l_id.layer_name,
      l_match.layer_name,
      b.work_layer
    ) AS layer_name,
    b.work_date,
    b.wall_names,
    b.area AS backend_area,
    b.painter_names,
    b.machine_or_manual,
    b.working_hours,
    b.work_status
  FROM
    (
      (
        indr.backend b
        LEFT JOIN indr.layer l_id ON (
          (
            indr.norm_text(l_id.layer_id) = indr.norm_text(b.layer_id)
          )
        )
      )
      LEFT JOIN indr.layer l_match ON (
        (
          (l_id.layer_id IS NULL)
          AND (
            indr.norm_text(l_match.application) = indr.norm_text(b.application)
          )
          AND (
            (
              indr.norm_text(l_match.flat_id) = indr.norm_text(b.flat)
            )
            OR (
              indr.norm_text(l_match.flat) = indr.norm_text(b.flat)
            )
          )
          AND (
            indr.norm_text(l_match.layer_name) = indr.norm_text(b.work_layer)
          )
        )
      )
    )
),
backend_split AS (
  SELECT
    bwl.backend_id,
    bwl.layer_id,
    bwl.block,
    bwl.application,
    bwl.flat_id,
    bwl.flat,
    bwl.layer_name,
    bwl.work_date,
    bwl.backend_area,
    bwl.painter_names,
    bwl.machine_or_manual,
    bwl.working_hours,
    bwl.work_status,
    w.item AS wall_name,
    count(*) OVER (PARTITION BY bwl.backend_id) AS wall_count
  FROM
    (
      backend_with_layer bwl
      JOIN LATERAL indr.split_text_list(bwl.wall_names) w(item) ON (TRUE)
    )
  WHERE
    (indr.norm_text(bwl.work_status) = 'DONE' :: text)
)
SELECT
  bs.backend_id,
  bs.layer_id,
  bs.block,
  bs.application,
  bs.flat_id,
  bs.flat,
  bs.layer_name,
  bs.work_date,
  bs.wall_name,
  COALESCE(sw.surface_type, 'Wall' :: text) AS surface_type,
  COALESCE(
    NULLIF(sw.wall_area, (0) :: numeric),
    (
      bs.backend_area / (NULLIF(bs.wall_count, 0)) :: numeric
    ),
    (0) :: numeric
  ) AS done_area,
  bs.painter_names,
  bs.machine_or_manual,
  bs.working_hours
FROM
  (
    backend_split bs
    LEFT JOIN indr.assignment_v_surface_wall sw ON (
      (
        (
          indr.norm_text(sw.application) = indr.norm_text(bs.application)
        )
        AND (
          indr.norm_text(sw.flat_id) = indr.norm_text(bs.flat_id)
        )
        AND (
          indr.norm_text(sw.wall_name) = indr.norm_text(bs.wall_name)
        )
      )
    )
  );