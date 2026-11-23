WITH target_date AS (
  SELECT
    COALESCE(
      (
        SELECT
          max(ar.assignment_date) AS max
        FROM
          indr.assignment_run ar
        WHERE
          (
            indr.norm_text(COALESCE(ar.status, '' :: text)) <> ALL (
              ARRAY ['REPLACED'::text, 'CANCELLED'::text, 'REMOVED'::text]
            )
          )
      ),
      (
        ((NOW() AT TIME ZONE 'Asia/Kolkata' :: text)) :: date + 1
      )
    ) AS target_assignment_date
),
surface_wall AS (
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
final_wall AS (
  SELECT
    fa.assignment_id,
    fa.assignment_date,
    fa.block,
    fa.application,
    fa.flat,
    fa.layer_id,
    fa.layer_name,
    fa.surface_type,
    faw.wall_name,
    COALESCE(
      NULLIF(faw.assigned_area, (0) :: numeric),
      NULLIF(faw.wall_area, (0) :: numeric),
      sw.wall_area,
      (0) :: numeric
    ) AS assigned_area
  FROM
    (
      (
        (
          indr.final_assignment fa
          JOIN indr.final_assignment_wall faw ON ((faw.assignment_id = fa.assignment_id))
        )
        CROSS JOIN target_date td
      )
      LEFT JOIN surface_wall sw ON (
        (
          (
            indr.norm_text(sw.application) = indr.norm_text(fa.application)
          )
          AND (
            indr.norm_text(sw.flat) = indr.norm_text(fa.flat)
          )
          AND (
            indr.norm_text(sw.wall_name) = indr.norm_text(faw.wall_name)
          )
          AND (
            indr.norm_text(sw.surface_type) = indr.norm_text(fa.surface_type)
          )
        )
      )
    )
  WHERE
    (
      (fa.assignment_date < td.target_assignment_date)
      AND (
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
),
reported_wall AS (
  SELECT
    b.assignment_id,
    COALESCE(b.layer_id, l_1.layer_id, '' :: text) AS layer_id,
    b.application,
    b.flat,
    COALESCE(sw.surface_type, '' :: text) AS surface_type,
    TRIM(
      BOTH
      FROM
        w.wall_name
    ) AS wall_name,
    sum(COALESCE(sw.wall_area, (0) :: numeric)) AS reported_area
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
      LEFT JOIN surface_wall sw ON (
        (
          (
            indr.norm_text(sw.application) = indr.norm_text(b.application)
          )
          AND (indr.norm_text(sw.flat) = indr.norm_text(b.flat))
          AND (
            indr.norm_text(sw.wall_name) = indr.norm_text(
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
    b.assignment_id,
    COALESCE(b.layer_id, l_1.layer_id, '' :: text),
    b.application,
    b.flat,
    COALESCE(sw.surface_type, '' :: text),
    (
      TRIM(
        BOTH
        FROM
          w.wall_name
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
                  'Rollover|' :: text || COALESCE((fw.assignment_id) :: text, '' :: text)
                ) || '|' :: text
              ) || COALESCE(fw.layer_id, '' :: text)
            ) || '|' :: text
          ) || COALESCE(fw.surface_type, '' :: text)
        ) || '|' :: text
      ) || COALESCE(fw.wall_name, '' :: text)
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
                  'RolloverWall|' :: text || COALESCE((fw.assignment_id) :: text, '' :: text)
                ) || '|' :: text
              ) || COALESCE(fw.layer_id, '' :: text)
            ) || '|' :: text
          ) || COALESCE(fw.surface_type, '' :: text)
        ) || '|' :: text
      ) || COALESCE(fw.wall_name, '' :: text)
    )
  ) AS source_wall_id,
  'Rollover' :: text AS section,
  1 AS priority_rank,
  'final_assignment' :: text AS source_table,
  fw.block,
  fw.application,
  fw.flat,
  fw.layer_id,
  fw.layer_name,
  fw.surface_type,
  COALESCE(l."order", (999) :: numeric) AS layer_order,
  COALESCE(l.billable, false) AS billable,
  fw.wall_name,
  fw.assigned_area AS wall_area,
  GREATEST(
    (
      fw.assigned_area - COALESCE(rw.reported_area, (0) :: numeric)
    ),
    (0) :: numeric
  ) AS remaining_area,
  fw.assignment_date AS oldest_date,
  'Available' :: text AS eligibility_status,
  NULL :: text AS risk_reason
FROM
  (
    (
      final_wall fw
      LEFT JOIN reported_wall rw ON (
        (
          (
            (rw.assignment_id = fw.assignment_id)
            OR (rw.assignment_id IS NULL)
          )
          AND (
            indr.norm_text(rw.layer_id) = indr.norm_text(fw.layer_id)
          )
          AND (
            indr.norm_text(rw.application) = indr.norm_text(fw.application)
          )
          AND (
            indr.norm_text(rw.flat) = indr.norm_text(fw.flat)
          )
          AND (
            indr.norm_text(rw.surface_type) = indr.norm_text(fw.surface_type)
          )
          AND (
            indr.norm_text(rw.wall_name) = indr.norm_text(fw.wall_name)
          )
        )
      )
    )
    LEFT JOIN indr.layer l ON ((l.layer_id = fw.layer_id))
  )
WHERE
  (
    GREATEST(
      (
        fw.assigned_area - COALESCE(rw.reported_area, (0) :: numeric)
      ),
      (0) :: numeric
    ) > (0) :: numeric
  );