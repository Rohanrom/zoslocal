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
    COALESCE(b.layer_id, l.layer_id, '' :: text) AS layer_id,
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
    COALESCE(b.layer_id, l.layer_id, '' :: text),
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
                      'Ongoing|' :: text || COALESCE(lp.application, '' :: text)
                    ) || '|' :: text
                  ) || COALESCE(lp.flat, '' :: text)
                ) || '|' :: text
              ) || COALESCE(lp.layer_id, '' :: text)
            ) || '|' :: text
          ) || COALESCE(lp.surface_type, '' :: text)
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
                  (
                    (
                      'OngoingWall|' :: text || COALESCE(lp.application, '' :: text)
                    ) || '|' :: text
                  ) || COALESCE(lp.flat, '' :: text)
                ) || '|' :: text
              ) || COALESCE(lp.layer_id, '' :: text)
            ) || '|' :: text
          ) || COALESCE(lp.surface_type, '' :: text)
        ) || '|' :: text
      ) || COALESCE(sw.wall_name, '' :: text)
    )
  ) AS source_wall_id,
  'Ongoing' :: text AS section,
  2 AS priority_rank,
  'backend' :: text AS source_table,
  lp.block,
  lp.application,
  lp.flat,
  lp.layer_id,
  lp.layer_name,
  lp.surface_type,
  lp.layer_order,
  lp.billable,
  sw.wall_name,
  sw.wall_area,
  sw.wall_area AS remaining_area,
  CURRENT_DATE AS oldest_date,
  'Available' :: text AS eligibility_status,
  NULL :: text AS risk_reason
FROM
  (
    (
      (
        layer_progress lp
        JOIN surface_wall sw ON (
          (
            (
              indr.norm_text(sw.application) = indr.norm_text(lp.application)
            )
            AND (
              indr.norm_text(sw.flat) = indr.norm_text(lp.flat)
            )
            AND (
              indr.norm_text(sw.surface_type) = indr.norm_text(lp.surface_type)
            )
          )
        )
      )
      LEFT JOIN done_wall dw ON (
        (
          (
            indr.norm_text(dw.application) = indr.norm_text(lp.application)
          )
          AND (
            indr.norm_text(dw.flat) = indr.norm_text(lp.flat)
          )
          AND (
            indr.norm_text(dw.layer_id) = indr.norm_text(lp.layer_id)
          )
          AND (
            indr.norm_text(dw.wall_name) = indr.norm_text(sw.wall_name)
          )
        )
      )
    )
    LEFT JOIN indr.assignment_v_rollover ro ON (
      (
        (
          indr.norm_text(ro.application) = indr.norm_text(lp.application)
        )
        AND (
          indr.norm_text(ro.flat) = indr.norm_text(lp.flat)
        )
        AND (
          indr.norm_text(ro.layer_id) = indr.norm_text(lp.layer_id)
        )
        AND (
          indr.norm_text(ro.surface_type) = indr.norm_text(lp.surface_type)
        )
        AND (
          indr.norm_text(ro.wall_name) = indr.norm_text(sw.wall_name)
        )
      )
    )
  )
WHERE
  (
    (lp.done_area > (0) :: numeric)
    AND (lp.done_area < lp.total_area)
    AND (dw.wall_name IS NULL)
    AND (ro.wall_name IS NULL)
  );