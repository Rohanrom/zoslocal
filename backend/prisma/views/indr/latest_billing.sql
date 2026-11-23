WITH max_batch AS (
  SELECT
    max(
      indr.get_tracker_batch_no(
        billing_tracker_indr."Batch no.",
        billing_tracker_indr."Batch"
      )
    ) AS latest_batch_no
  FROM
    indr.billing_tracker_indr
  WHERE
    (
      indr.get_tracker_batch_no(
        billing_tracker_indr."Batch no.",
        billing_tracker_indr."Batch"
      ) IS NOT NULL
    )
)
SELECT
  t.id,
  t."Application",
  t."Flat",
  t."Surface Type",
  t."Layer Name",
  t."Billed",
  t."Billing Number",
  t."Billing Date",
  t."Rate",
  t."Billing Area",
  t."Status",
  t."Batch no.",
  t."WorkDonePct",
  t."Is Complete",
  t."Can Billed",
  t."Batch"
FROM
  (
    indr.billing_tracker_indr t
    CROSS JOIN max_batch mb
  )
WHERE
  (
    indr.get_tracker_batch_no(t."Batch no.", t."Batch") = mb.latest_batch_no
  );