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
final_wall_base AS (
  SELECT
    fa.assignment_id,
    fa.assignment_date,
    fa.block,
    fa.application,
    fa.flat,
    fa.layer_id,
    fa.layer_name,
    fa.surface_type,
    fa.machine_or_manual,
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
        indr.final_assignment fa
        JOIN indr.final_assignment_wall faw ON ((faw.assignment_id = fa.assignment_id))
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
        )
      )
    )
  WHERE
    (
      (fa.assignment_date = CURRENT_DATE)
      AND (
        indr.norm_text(fa.status) <> ALL (
          ARRAY ['REPLACED'::text, 'CANCELLED'::text, 'REMOVED'::text]
        )
      )
      AND (
        indr.norm_text(faw.wall_status) <> ALL (
          ARRAY ['REPLACED'::text, 'CANCELLED'::text, 'REMOVED'::text]
        )
      )
    )
),
final_wall AS (
  SELECT
    final_wall_base.assignment_id,
    final_wall_base.assignment_date,
    final_wall_base.block,
    final_wall_base.application,
    final_wall_base.flat,
    final_wall_base.layer_id,
    final_wall_base.layer_name,
    final_wall_base.surface_type,
    final_wall_base.machine_or_manual,
    final_wall_base.wall_name,
    max(final_wall_base.assigned_area) AS assigned_area
  FROM
    final_wall_base
  GROUP BY
    final_wall_base.assignment_id,
    final_wall_base.assignment_date,
    final_wall_base.block,
    final_wall_base.application,
    final_wall_base.flat,
    final_wall_base.layer_id,
    final_wall_base.layer_name,
    final_wall_base.surface_type,
    final_wall_base.machine_or_manual,
    final_wall_base.wall_name
),
reported_wall AS (
  SELECT
    b.assignment_id,
    COALESCE(b.layer_id, '' :: text) AS layer_id,
    b.application,
    b.flat,
    TRIM(
      BOTH
      FROM
        w.wall_name
    ) AS wall_name,
    sum(COALESCE(sw.wall_area, (0) :: numeric)) AS reported_area
  FROM
    (
      (
        indr.backend b
        CROSS JOIN LATERAL regexp_split_to_table(
          COALESCE(b.wall_names, '' :: text),
          '\s*,\s*' :: text
        ) w(wall_name)
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
      (b.assignment_id IS NOT NULL)
      AND (indr.norm_text(b.work_status) = 'DONE' :: text)
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
    COALESCE(b.layer_id, '' :: text),
    b.application,
    b.flat,
    (
      TRIM(
        BOTH
        FROM
          w.wall_name
      )
    )
),
final_group AS (
  SELECT
    fw.assignment_id,
    fw.assignment_date,
    fw.block,
    fw.application,
    fw.flat,
    fw.layer_id,
    fw.layer_name,
    fw.surface_type,
    fw.machine_or_manual,
    string_agg(
      fw.wall_name,
      ', ' :: text
      ORDER BY
        fw.wall_name
    ) AS assigned_wall_names,
    sum(fw.assigned_area) AS assigned_area
  FROM
    final_wall fw
  GROUP BY
    fw.assignment_id,
    fw.assignment_date,
    fw.block,
    fw.application,
    fw.flat,
    fw.layer_id,
    fw.layer_name,
    fw.surface_type,
    fw.machine_or_manual
),
reported_group AS (
  SELECT
    rw.assignment_id,
    rw.layer_id,
    rw.application,
    rw.flat,
    string_agg(
      rw.wall_name,
      ', ' :: text
      ORDER BY
        rw.wall_name
    ) AS reported_wall_names,
    sum(rw.reported_area) AS reported_area
  FROM
    reported_wall rw
  GROUP BY
    rw.assignment_id,
    rw.layer_id,
    rw.application,
    rw.flat
),
pending_wall AS (
  SELECT
    fw.assignment_id,
    fw.assignment_date,
    fw.block,
    fw.application,
    fw.flat,
    fw.layer_id,
    fw.layer_name,
    fw.surface_type,
    fw.machine_or_manual,
    fw.wall_name,
    GREATEST(
      (
        fw.assigned_area - COALESCE(rw.reported_area, (0) :: numeric)
      ),
      (0) :: numeric
    ) AS pending_area
  FROM
    (
      final_wall fw
      LEFT JOIN reported_wall rw ON (
        (
          (rw.assignment_id = fw.assignment_id)
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
            indr.norm_text(rw.wall_name) = indr.norm_text(fw.wall_name)
          )
        )
      )
    )
  WHERE
    (
      GREATEST(
        (
          fw.assigned_area - COALESCE(rw.reported_area, (0) :: numeric)
        ),
        (0) :: numeric
      ) > (0) :: numeric
    )
),
pending_group AS (
  SELECT
    pw.assignment_id,
    pw.assignment_date,
    pw.block,
    pw.application,
    pw.flat,
    pw.layer_id,
    pw.layer_name,
    pw.surface_type,
    pw.machine_or_manual,
    string_agg(
      pw.wall_name,
      ', ' :: text
      ORDER BY
        pw.wall_name
    ) AS pending_wall_names,
    sum(pw.pending_area) AS pending_area
  FROM
    pending_wall pw
  GROUP BY
    pw.assignment_id,
    pw.assignment_date,
    pw.block,
    pw.application,
    pw.flat,
    pw.layer_id,
    pw.layer_name,
    pw.surface_type,
    pw.machine_or_manual
)
SELECT
  pg.assignment_id,
  pg.assignment_date,
  pg.block,
  pg.application,
  pg.flat,
  pg.layer_id,
  pg.layer_name,
  pg.surface_type,
  fg.assigned_wall_names,
  pg.pending_wall_names,
  COALESCE(fg.assigned_area, (0) :: numeric) AS assigned_area,
  COALESCE(rg.reported_area, (0) :: numeric) AS reported_area,
  COALESCE(pg.pending_area, (0) :: numeric) AS pending_area,
  COALESCE(
    indr.assignment_get_productivity_per_hour(
      pg.application,
      pg.layer_name,
      pg.machine_or_manual
    ),
    (0) :: numeric
  ) AS productivity_per_hour,
  CASE
    WHEN (
      COALESCE(
        indr.assignment_get_productivity_per_hour(
          pg.application,
          pg.layer_name,
          pg.machine_or_manual
        ),
        (0) :: numeric
      ) > (0) :: numeric
    ) THEN round(
      (
        pg.pending_area / indr.assignment_get_productivity_per_hour(
          pg.application,
          pg.layer_name,
          pg.machine_or_manual
        )
      ),
      2
    )
    ELSE (0) :: numeric
  END AS hours_for_one_painter,
  pg.machine_or_manual,
  0 AS painter_count,
  NULL :: text [] AS assigned_painter_ids,
  NULL :: text [] AS assigned_painter_names,
  CASE
    WHEN (
      COALESCE(rg.reported_area, (0) :: numeric) <= (0) :: numeric
    ) THEN 'Pending' :: text
    WHEN (
      COALESCE(rg.reported_area, (0) :: numeric) < COALESCE(fg.assigned_area, (0) :: numeric)
    ) THEN 'Partial' :: text
    ELSE 'Completed' :: text
  END AS reporting_status
FROM
  (
    (
      pending_group pg
      JOIN final_group fg ON (
        (
          (fg.assignment_id = pg.assignment_id)
          AND (
            indr.norm_text(fg.layer_id) = indr.norm_text(pg.layer_id)
          )
          AND (
            indr.norm_text(fg.surface_type) = indr.norm_text(pg.surface_type)
          )
        )
      )
    )
    LEFT JOIN reported_group rg ON (
      (
        (rg.assignment_id = pg.assignment_id)
        AND (
          indr.norm_text(rg.layer_id) = indr.norm_text(pg.layer_id)
        )
        AND (
          indr.norm_text(rg.application) = indr.norm_text(pg.application)
        )
        AND (
          indr.norm_text(rg.flat) = indr.norm_text(pg.flat)
        )
      )
    )
  )
WHERE
  (
    COALESCE(pg.pending_area, (0) :: numeric) > (0) :: numeric
  )
ORDER BY
  pg.application,
  pg.flat,
  pg.layer_name,
  pg.surface_type;