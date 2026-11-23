WITH flat_summary AS (
  SELECT
    v."Flat" AS "FlatID",
    string_agg(
      DISTINCT v."Application",
      ', ' :: text
      ORDER BY
        v."Application"
    ) AS "Application",
    count(*) AS "Billable Layer Count",
    count(*) FILTER (
      WHERE
        (
          (v."Remaining Area" <= (0) :: numeric)
          OR (v."Work Done Pct" >= (100) :: numeric)
        )
    ) AS "Completed Billable Layer Count",
    round(sum(v."Projection Total Area"), 2) AS "Billable Total Area",
    round(sum(v."Projection Done Area"), 2) AS "Billable Done Area",
    round(sum(v."Remaining Area"), 2) AS "Billable Remaining Area",
    round(
      CASE
        WHEN (sum(v."Projection Total Area") > (0) :: numeric) THEN (
          (
            sum(v."Projection Done Area") / sum(v."Projection Total Area")
          ) * (100) :: numeric
        )
        ELSE (0) :: numeric
      END,
      2
    ) AS "Flat Completion Pct"
  FROM
    v_projection_layers_billable_base v
  GROUP BY
    v."Flat"
)
SELECT
  f."FlatID",
  f."ApplicationID",
  fs."Application",
  f."FlatName" AS "Flat",
  (COALESCE(fs."Billable Layer Count", (0) :: bigint)) :: integer AS "Billable Layer Count",
  (
    COALESCE(fs."Completed Billable Layer Count", (0) :: bigint)
  ) :: integer AS "Completed Billable Layer Count",
  COALESCE(fs."Billable Total Area", (0) :: numeric) AS "Billable Total Area",
  COALESCE(fs."Billable Done Area", (0) :: numeric) AS "Billable Done Area",
  COALESCE(fs."Billable Remaining Area", (0) :: numeric) AS "Billable Remaining Area",
  COALESCE(fs."Flat Completion Pct", (0) :: numeric) AS "Flat Completion Pct",
  zos_to_numeric(f."Projection Total Area") AS "Flat Master Projection Total Area"
FROM
  (
    "flat aph(1)" f
    LEFT JOIN flat_summary fs ON (
      (
        upper(
          TRIM(
            BOTH
            FROM
              COALESCE(fs."FlatID", '' :: text)
          )
        ) = upper(
          TRIM(
            BOTH
            FROM
              COALESCE(f."FlatID", '' :: text)
          )
        )
      )
    )
  );