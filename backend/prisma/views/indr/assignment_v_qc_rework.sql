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
    COALESCE(b.layer_id, l_1.layer_id) AS layer_id,
    TRIM(
      BOTH
      FROM
        w.wall_name
    ) AS wall_name
  FROM
    (
      (
        indr.backend b
        CROSS JOIN LATERAL regexp_split_to_table(
          COALESCE(b.wall_names, '' :: text),
          '\s*,\s*' :: text
        ) w(wall_name)
      )
      LEFT JOIN indr.layer l_1 ON (
        (
          (
            indr.norm_text(l_1.application) = indr.norm_text(b.application)
          )
          AND (
            indr.norm_text(l_1.flat_id) = indr.norm_text(b.flat)
          )
          AND (
            indr.norm_text(l_1.layer_name) = indr.norm_text(b.work_layer)
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
)
SELECT
  md5(
    (
      (
        ('QC|' :: text || COALESCE(q.qc_id, '' :: text)) || '|' :: text
      ) || COALESCE(q.wall_name, '' :: text)
    )
  ) AS source_id,
  md5(
    (
      (
        ('QCWall|' :: text || COALESCE(q.qc_id, '' :: text)) || '|' :: text
      ) || COALESCE(q.wall_name, '' :: text)
    )
  ) AS source_wall_id,
  'QC Rework' :: text AS section,
  3 AS priority_rank,
  'indr_qc' :: text AS source_table,
  COALESCE(q.block, sw.block) AS block,
  q.application,
  q.flat,
  COALESCE(q.layer_id, l.layer_id) AS layer_id,
  COALESCE(q.layer_name, l.layer_name) AS layer_name,
  sw.surface_type,
  COALESCE(l."order", q.layer_order, (999) :: numeric) AS layer_order,
  COALESCE(l.billable, false) AS billable,
  q.wall_name,
  COALESCE(sw.wall_area, (0) :: numeric) AS wall_area,
  COALESCE(sw.wall_area, (0) :: numeric) AS remaining_area,
  q.qc_date AS oldest_date,
  'Available' :: text AS eligibility_status,
  q.qc_result AS risk_reason
FROM
  (
    (
      (
        indr.assignment_v_qc_latest_wall q
        LEFT JOIN surface_wall sw ON (
          (
            (
              indr.norm_text(sw.application) = indr.norm_text(q.application)
            )
            AND (indr.norm_text(sw.flat) = indr.norm_text(q.flat))
            AND (
              indr.norm_text(sw.wall_name) = indr.norm_text(q.wall_name)
            )
          )
        )
      )
      LEFT JOIN indr.layer l ON ((l.layer_id = q.layer_id))
    )
    LEFT JOIN done_wall dw ON (
      (
        (
          indr.norm_text(dw.application) = indr.norm_text(q.application)
        )
        AND (indr.norm_text(dw.flat) = indr.norm_text(q.flat))
        AND (
          indr.norm_text(dw.layer_id) = indr.norm_text(COALESCE(q.layer_id, l.layer_id))
        )
        AND (
          indr.norm_text(dw.wall_name) = indr.norm_text(q.wall_name)
        )
      )
    )
  )
WHERE
  (
    (
      indr.norm_text(q.qc_result) = ANY (
        ARRAY ['FAIL'::text, 'FAILED'::text, 'REWORK'::text, 'REJECTED'::text]
      )
    )
    AND (dw.wall_name IS NULL)
    AND (
      COALESCE(sw.wall_area, (0) :: numeric) > (0) :: numeric
    )
  );