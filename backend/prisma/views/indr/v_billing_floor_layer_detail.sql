WITH latest_batch AS (
  SELECT
    max(v_billing_layer_surface_billed.batch_no) AS latest_batch_no
  FROM
    indr.v_billing_layer_surface_billed
),
layer_master AS (
  SELECT
    invoice_table."Layer Name" AS layer_name,
    min(invoice_table."Sl No") AS layer_sort
  FROM
    indr.invoice_table
  WHERE
    (
      NULLIF(
        TRIM(
          BOTH
          FROM
            COALESCE(invoice_table."Layer Name", '' :: text)
        ),
        '' :: text
      ) IS NOT NULL
    )
  GROUP BY
    invoice_table."Layer Name"
  UNION
  SELECT
    billing_tracker_indr."Layer Name" AS layer_name,
    999 AS layer_sort
  FROM
    indr.billing_tracker_indr
  WHERE
    (
      NULLIF(
        TRIM(
          BOTH
          FROM
            COALESCE(billing_tracker_indr."Layer Name", '' :: text)
        ),
        '' :: text
      ) IS NOT NULL
    )
  GROUP BY
    billing_tracker_indr."Layer Name"
),
billed_keys AS (
  SELECT
    v_billing_layer_surface_billed.application,
    v_billing_layer_surface_billed.flat,
    v_billing_layer_surface_billed.row_type,
    v_billing_layer_surface_billed.report_description,
    v_billing_layer_surface_billed.floor_no,
    v_billing_layer_surface_billed.floor_label,
    v_billing_layer_surface_billed.layer_name
  FROM
    indr.v_billing_layer_surface_billed
  GROUP BY
    v_billing_layer_surface_billed.application,
    v_billing_layer_surface_billed.flat,
    v_billing_layer_surface_billed.row_type,
    v_billing_layer_surface_billed.report_description,
    v_billing_layer_surface_billed.floor_no,
    v_billing_layer_surface_billed.floor_label,
    v_billing_layer_surface_billed.layer_name
),
ceiling_data AS (
  SELECT
    v_billing_layer_surface_billed.id,
    v_billing_layer_surface_billed.application,
    v_billing_layer_surface_billed.flat,
    v_billing_layer_surface_billed.row_type,
    v_billing_layer_surface_billed.report_description,
    v_billing_layer_surface_billed.floor_no,
    v_billing_layer_surface_billed.floor_label,
    v_billing_layer_surface_billed.layer_name,
    v_billing_layer_surface_billed.surface_type,
    v_billing_layer_surface_billed.billing_date,
    v_billing_layer_surface_billed.billing_number,
    v_billing_layer_surface_billed.rate,
    v_billing_layer_surface_billed.billing_area,
    v_billing_layer_surface_billed.batch,
    v_billing_layer_surface_billed.batch_no
  FROM
    indr.v_billing_layer_surface_billed
  WHERE
    (
      lower(
        TRIM(
          BOTH
          FROM
            v_billing_layer_surface_billed.surface_type
        )
      ) = 'ceiling' :: text
    )
),
wall_data AS (
  SELECT
    v_billing_layer_surface_billed.id,
    v_billing_layer_surface_billed.application,
    v_billing_layer_surface_billed.flat,
    v_billing_layer_surface_billed.row_type,
    v_billing_layer_surface_billed.report_description,
    v_billing_layer_surface_billed.floor_no,
    v_billing_layer_surface_billed.floor_label,
    v_billing_layer_surface_billed.layer_name,
    v_billing_layer_surface_billed.surface_type,
    v_billing_layer_surface_billed.billing_date,
    v_billing_layer_surface_billed.billing_number,
    v_billing_layer_surface_billed.rate,
    v_billing_layer_surface_billed.billing_area,
    v_billing_layer_surface_billed.batch,
    v_billing_layer_surface_billed.batch_no
  FROM
    indr.v_billing_layer_surface_billed
  WHERE
    (
      lower(
        TRIM(
          BOTH
          FROM
            v_billing_layer_surface_billed.surface_type
        )
      ) = 'wall' :: text
    )
)
SELECT
  bk.row_type,
  CASE
    WHEN (bk.row_type = 'CORRIDOR' :: text) THEN (bk.floor_label || ' Corridor' :: text)
    ELSE ((bk.floor_label || ' ' :: text) || bk.layer_name)
  END AS section_title,
  bk.floor_label,
  bk.floor_no,
  bk.application,
  bk.flat,
  bk.report_description AS description,
  bk.layer_name,
  COALESCE(lm.layer_sort, (999) :: numeric) AS layer_sort,
  'Sqm' :: text AS unit,
  NULL :: numeric AS nos,
  COALESCE(c.billing_area, (0) :: numeric) AS ceiling_area,
  c.batch AS ceiling_batch,
  c.batch_no AS ceiling_batch_no,
  c.billing_date AS ceiling_billing_date,
  c.billing_number AS ceiling_billing_number,
  COALESCE(w.billing_area, (0) :: numeric) AS wall_area,
  w.batch AS wall_batch,
  w.batch_no AS wall_batch_no,
  w.billing_date AS wall_billing_date,
  w.billing_number AS wall_billing_number,
  CASE
    WHEN (
      (c.batch IS NOT NULL)
      AND (w.batch IS NOT NULL)
      AND (c.batch = w.batch)
    ) THEN c.batch
    WHEN (
      (c.batch IS NOT NULL)
      AND (w.batch IS NOT NULL)
      AND (c.batch <> w.batch)
    ) THEN (
      (
        ('Ceiling: ' :: text || c.batch) || ' | Wall: ' :: text
      ) || w.batch
    )
    WHEN (c.batch IS NOT NULL) THEN ('Ceiling: ' :: text || c.batch)
    WHEN (w.batch IS NOT NULL) THEN ('Wall: ' :: text || w.batch)
    ELSE NULL :: text
  END AS batch_summary,
  GREATEST(COALESCE(c.batch_no, 0), COALESCE(w.batch_no, 0)) AS latest_row_batch_no,
  CASE
    WHEN (
      GREATEST(COALESCE(c.batch_no, 0), COALESCE(w.batch_no, 0)) = lb.latest_batch_no
    ) THEN TRUE
    ELSE false
  END AS is_latest_batch,
  CASE
    WHEN (
      GREATEST(COALESCE(c.batch_no, 0), COALESCE(w.batch_no, 0)) = lb.latest_batch_no
    ) THEN 'Latest billed' :: text
    ELSE '' :: text
  END AS row_highlight,
  round(
    (
      COALESCE(c.billing_area, (0) :: numeric) + COALESCE(w.billing_area, (0) :: numeric)
    ),
    2
  ) AS total_area
FROM
  (
    (
      (
        (
          billed_keys bk
          CROSS JOIN latest_batch lb
        )
        LEFT JOIN layer_master lm ON ((lm.layer_name = bk.layer_name))
      )
      LEFT JOIN ceiling_data c ON (
        (
          (c.application = bk.application)
          AND (c.flat = bk.flat)
          AND (c.layer_name = bk.layer_name)
        )
      )
    )
    LEFT JOIN wall_data w ON (
      (
        (w.application = bk.application)
        AND (w.flat = bk.flat)
        AND (w.layer_name = bk.layer_name)
      )
    )
  );