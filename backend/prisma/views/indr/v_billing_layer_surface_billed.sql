WITH tracker_source AS (
  SELECT
    t.id,
    t."Application" AS application,
    t."Flat" AS flat,
    indr.billing_row_type(t."Application", t."Flat") AS row_type,
    indr.billing_report_description(t."Application", t."Flat") AS report_description,
    indr.billing_floor_no(t."Application", t."Flat") AS floor_no,
    indr.billing_floor_label(indr.billing_floor_no(t."Application", t."Flat")) AS floor_label,
    t."Layer Name" AS layer_name,
    t."Surface Type" AS surface_type,
    t."Billing Date" AS billing_date,
    t."Billing Number" AS billing_number,
    t."Rate" AS rate,
    COALESCE(
      NULLIF(
        TRIM(
          BOTH
          FROM
            COALESCE(t."Batch", '' :: text)
        ),
        '' :: text
      ),
      CASE
        WHEN (t."Batch no." IS NOT NULL) THEN ('B' :: text || (t."Batch no.") :: text)
        ELSE NULL :: text
      END
    ) AS batch,
    indr.get_tracker_batch_no(t."Batch no.", t."Batch") AS batch_no,
    CASE
      WHEN (
        COALESCE(t."Billing Area", (0) :: numeric) > (0) :: numeric
      ) THEN COALESCE(t."Billing Area", (0) :: numeric)
      WHEN (
        lower(
          TRIM(
            BOTH
            FROM
              COALESCE(t."Surface Type", '' :: text)
          )
        ) = 'ceiling' :: text
      ) THEN COALESCE(fa."Ceiling Area", (0) :: numeric)
      WHEN (
        lower(
          TRIM(
            BOTH
            FROM
              COALESCE(t."Surface Type", '' :: text)
          )
        ) = 'wall' :: text
      ) THEN COALESCE(fa."Wall Area", (0) :: numeric)
      ELSE (0) :: numeric
    END AS billing_area
  FROM
    (
      indr.billing_tracker_indr t
      LEFT JOIN indr.flat_area fa ON (
        (
          TRIM(
            BOTH
            FROM
              fa."Flat"
          ) = TRIM(
            BOTH
            FROM
              t."Flat"
          )
        )
      )
    )
  WHERE
    (
      (
        (COALESCE(t."Billed", false) = TRUE)
        OR (
          lower(
            TRIM(
              BOTH
              FROM
                COALESCE(t."Status", '' :: text)
            )
          ) = ANY (ARRAY ['approved'::text, 'billed'::text])
        )
        OR (
          NULLIF(
            TRIM(
              BOTH
              FROM
                COALESCE(t."Batch", '' :: text)
            ),
            '' :: text
          ) IS NOT NULL
        )
        OR (t."Batch no." IS NOT NULL)
      )
      AND (
        NULLIF(
          TRIM(
            BOTH
            FROM
              COALESCE(t."Application", '' :: text)
          ),
          '' :: text
        ) IS NOT NULL
      )
      AND (
        NULLIF(
          TRIM(
            BOTH
            FROM
              COALESCE(t."Flat", '' :: text)
          ),
          '' :: text
        ) IS NOT NULL
      )
      AND (
        NULLIF(
          TRIM(
            BOTH
            FROM
              COALESCE(t."Layer Name", '' :: text)
          ),
          '' :: text
        ) IS NOT NULL
      )
      AND (
        NULLIF(
          TRIM(
            BOTH
            FROM
              COALESCE(t."Surface Type", '' :: text)
          ),
          '' :: text
        ) IS NOT NULL
      )
    )
),
ranked AS (
  SELECT
    tracker_source.id,
    tracker_source.application,
    tracker_source.flat,
    tracker_source.row_type,
    tracker_source.report_description,
    tracker_source.floor_no,
    tracker_source.floor_label,
    tracker_source.layer_name,
    tracker_source.surface_type,
    tracker_source.billing_date,
    tracker_source.billing_number,
    tracker_source.rate,
    tracker_source.batch,
    tracker_source.batch_no,
    tracker_source.billing_area,
    row_number() OVER (
      PARTITION BY tracker_source.application,
      tracker_source.flat,
      tracker_source.layer_name,
      tracker_source.surface_type
      ORDER BY
        tracker_source.batch_no DESC NULLS LAST,
        tracker_source.billing_date DESC NULLS LAST,
        tracker_source.id DESC
    ) AS rn
  FROM
    tracker_source
)
SELECT
  id,
  application,
  flat,
  row_type,
  report_description,
  floor_no,
  floor_label,
  layer_name,
  surface_type,
  billing_date,
  billing_number,
  rate,
  round(COALESCE(billing_area, (0) :: numeric), 2) AS billing_area,
  batch,
  batch_no
FROM
  ranked
WHERE
  (rn = 1);