SELECT
  id,
  "Application",
  "Flat",
  "Surface Type",
  "Layer Name",
  "Billed",
  "Billing Number",
  "Billing Date",
  "Rate",
  "Billing Area",
  "Status",
  "Batch no.",
  "WorkDonePct",
  "Is Complete",
  "Can Billed",
  "Batch"
FROM
  indr.billing_tracker_indr
WHERE
  (
    (COALESCE("Billed", false) = TRUE)
    OR (
      upper(
        TRIM(
          BOTH
          FROM
            COALESCE("Status", '' :: text)
        )
      ) = 'APPROVED' :: text
    )
    OR (
      NULLIF(
        TRIM(
          BOTH
          FROM
            COALESCE("Batch", '' :: text)
        ),
        '' :: text
      ) IS NOT NULL
    )
    OR ("Batch no." IS NOT NULL)
  );