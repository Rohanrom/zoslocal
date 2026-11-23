WITH surface_wall AS (
  SELECT
    sn.block,
    sn.application,
    sn.base AS flat,
    sn.wall AS wall_name,
    initcap(sn.surface_type) AS surface_type,
    COALESCE(sn.total_area_sft, (0) :: numeric) AS wall_area
  FROM
    indr.surface_number sn
),
done_wall AS (
  SELECT
    b.application,
    b.flat,
    COALESCE(b.layer_id, l.layer_id) AS layer_id,
    TRIM(
      BOTH
      FROM
        w.wall_name
    ) AS wall_name,
    sum(COALESCE(sw_1.wall_area, (0) :: numeric)) AS done_area
  FROM
    (
      (
        (
          indr.backend b
          CROSS JOIN LATERAL regexp_split_to_table(
            COALESCE(b.wall_names, '' :: text),
            '\s*,\s*' :: text
          ) w(wall_name)
        )
        LEFT JOIN indr.layer l ON (
          (
            (
              indr.norm_text(l.application) = indr.norm_text(b.application)
            )
            AND (
              indr.norm_text(l.flat_id) = indr.norm_text(b.flat)
            )
            AND (
              indr.norm_text(l.layer_name) = indr.norm_text(b.work_layer)
            )
          )
        )
      )
      LEFT JOIN surface_wall sw_1 ON (
        (
          (
            indr.norm_text(sw_1.application) = indr.norm_text(b.application)
          )
          AND (
            indr.norm_text(sw_1.flat) = indr.norm_text(b.flat)
          )
          AND (
            indr.norm_text(sw_1.wall_name) = indr.norm_text(
              TRIM(
                BOTH
                FROM
                  w.wall_name
              )
            )
          )
        )
      )
    )
  WHERE
    (
      (indr.norm_text(b.work_status) = 'DONE' :: text)
      AND (
        TRIM(
          BOTH
          FROM
            w.wall_name
        ) <> '' :: text
      )
    )
  GROUP BY
    b.application,
    b.flat,
    COALESCE(b.layer_id, l.layer_id),
    (
      TRIM(
        BOTH
        FROM
          w.wall_name
      )
    )
),
layer_progress AS (
  SELECT
    l.layer_id,
    l.block,
    l.application,
    l.flat_id AS flat,
    l.layer_name,
    sw_1.surface_type,
    COALESCE(l."order", (999) :: numeric) AS layer_order,
    COALESCE(l.billable, false) AS billable,
    sum(sw_1.wall_area) AS total_area,
    COALESCE(sum(dw_1.done_area), (0) :: numeric) AS done_area
  FROM
    (
      (
        indr.layer l
        JOIN surface_wall sw_1 ON (
          (
            (
              indr.norm_text(sw_1.application) = indr.norm_text(l.application)
            )
            AND (
              indr.norm_text(sw_1.flat) = indr.norm_text(l.flat_id)
            )
          )
        )
      )
      LEFT JOIN done_wall dw_1 ON (
        (
          (
            indr.norm_text(dw_1.application) = indr.norm_text(l.application)
          )
          AND (
            indr.norm_text(dw_1.flat) = indr.norm_text(l.flat_id)
          )
          AND (
            indr.norm_text(dw_1.layer_id) = indr.norm_text(l.layer_id)
          )
          AND (
            indr.norm_text(dw_1.wall_name) = indr.norm_text(sw_1.wall_name)
          )
        )
      )
    )
  GROUP BY
    l.layer_id,
    l.block,
    l.application,
    l.flat_id,
    l.layer_name,
    sw_1.surface_type,
    COALESCE(l."order", (999) :: numeric),
    COALESCE(l.billable, false)
),
eligible_layer AS (
  SELECT
    lp.layer_id,
    lp.block,
    lp.application,
    lp.flat,
    lp.layer_name,
    lp.surface_type,
    lp.layer_order,
    lp.billable,
    lp.total_area,
    lp.done_area
  FROM
    layer_progress lp
  WHERE
    (
      (lp.done_area = (0) :: numeric)
      AND (
        (lp.billable = false)
        OR (
          NOT (
            EXISTS (
              SELECT
                1
              FROM
                layer_progress prev
              WHERE
                (
                  (
                    indr.norm_text(prev.application) = indr.norm_text(lp.application)
                  )
                  AND (
                    indr.norm_text(prev.flat) = indr.norm_text(lp.flat)
                  )
                  AND (
                    indr.norm_text(prev.surface_type) = indr.norm_text(lp.surface_type)
                  )
                  AND (prev.billable = TRUE)
                  AND (prev.layer_order < lp.layer_order)
                  AND (prev.done_area < prev.total_area)
                )
            )
          )
        )
      )
    )
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
                  'NewLayer|' :: text || COALESCE(el.application, '' :: text)
                ) || '|' :: text
              ) || COALESCE(el.flat, '' :: text)
            ) || '|' :: text
          ) || COALESCE(el.layer_id, '' :: text)
        ) || '|' :: text
      ) || COALESCE(sw.wall_name, '' :: text)
    )
  ) AS source_id,
  md5(
    (
      (
        (
          (
            (
              (
                (
                  'NewLayerWall|' :: text || COALESCE(el.application, '' :: text)
                ) || '|' :: text
              ) || COALESCE(el.flat, '' :: text)
            ) || '|' :: text
          ) || COALESCE(el.layer_id, '' :: text)
        ) || '|' :: text
      ) || COALESCE(sw.wall_name, '' :: text)
    )
  ) AS source_wall_id,
  'Next Layer Ready' :: text AS section,
  4 AS priority_rank,
  'layer' :: text AS source_table,
  el.block,
  el.application,
  el.flat,
  el.layer_id,
  el.layer_name,
  el.surface_type,
  el.layer_order,
  el.billable,
  sw.wall_name,
  sw.wall_area,
  sw.wall_area AS remaining_area,
  CURRENT_DATE AS oldest_date,
  'Available' :: text AS eligibility_status,
  NULL :: text AS risk_reason
FROM
  (
    (
      eligible_layer el
      JOIN surface_wall sw ON (
        (
          (
            indr.norm_text(sw.application) = indr.norm_text(el.application)
          )
          AND (
            indr.norm_text(sw.flat) = indr.norm_text(el.flat)
          )
          AND (
            indr.norm_text(sw.surface_type) = indr.norm_text(el.surface_type)
          )
        )
      )
    )
    LEFT JOIN done_wall dw ON (
      (
        (
          indr.norm_text(dw.application) = indr.norm_text(el.application)
        )
        AND (
          indr.norm_text(dw.flat) = indr.norm_text(el.flat)
        )
        AND (
          indr.norm_text(dw.layer_id) = indr.norm_text(el.layer_id)
        )
        AND (
          indr.norm_text(dw.wall_name) = indr.norm_text(sw.wall_name)
        )
      )
    )
  )
WHERE
  (dw.wall_name IS NULL);