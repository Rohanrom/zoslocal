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
    (COALESCE("Billed", false) = false)
    AND (
      COALESCE("WorkDonePct", (0) :: numeric) >= (1) :: numeric
    )
    AND (
      upper(
        TRIM(
          BOTH
          FROM
            COALESCE("Status", '' :: text)
        )
      ) = 'NA' :: text
    )
  );