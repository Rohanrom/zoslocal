WITH order_master AS (
  SELECT
    DISTINCT ON (
      (
        upper(
          TRIM(
            BOTH
            FROM
              COALESCE("order aph(2)"."Application", '' :: text)
          )
        )
      ),
      (
        upper(
          TRIM(
            BOTH
            FROM
              COALESCE("order aph(2)"."Work Layer", '' :: text)
          )
        )
      )
    ) "order aph(2)"."Application",
    "order aph(2)"."Work Layer",
    "order aph(2)"."Order",
    "order aph(2)"."Billable"
  FROM
    "order aph(2)"
  ORDER BY
    (
      upper(
        TRIM(
          BOTH
          FROM
            COALESCE("order aph(2)"."Application", '' :: text)
        )
      )
    ),
    (
      upper(
        TRIM(
          BOTH
          FROM
            COALESCE("order aph(2)"."Work Layer", '' :: text)
        )
      )
    ),
    "order aph(2)"."Order"
),
layer_base AS (
  SELECT
    l."LayerID",
    l."Block",
    l."Application",
    l."Flat",
    l."LAYERName",
    l."ID",
    l."Related Backends",
    l."Projection Order",
    l."Projection Work Mode",
    om."Order" AS "Billable Layer Order",
    om."Billable",
    zos_to_numeric(l."Projection Total Area") AS total_area,
    zos_to_numeric(l."Projection Done Area") AS done_area,
    mp."Material Name" AS material_name,
    zos_to_numeric((mp."Coverage") :: text) AS material_coverage,
    zos_to_numeric((mp."Rate") :: text) AS material_rate
  FROM
    (
      (
        "layer aph(1)" l
        JOIN order_master om ON (
          (
            (
              upper(
                TRIM(
                  BOTH
                  FROM
                    COALESCE(om."Application", '' :: text)
                )
              ) = upper(
                TRIM(
                  BOTH
                  FROM
                    COALESCE(l."Application", '' :: text)
                )
              )
            )
            AND (
              upper(
                TRIM(
                  BOTH
                  FROM
                    COALESCE(om."Work Layer", '' :: text)
                )
              ) = upper(
                TRIM(
                  BOTH
                  FROM
                    COALESCE(l."LAYERName", '' :: text)
                )
              )
            )
          )
        )
      )
      LEFT JOIN "material projection" mp ON (
        (
          (
            upper(
              TRIM(
                BOTH
                FROM
                  COALESCE(mp."Application", '' :: text)
              )
            ) = upper(
              TRIM(
                BOTH
                FROM
                  COALESCE(l."Application", '' :: text)
              )
            )
          )
          AND (
            upper(
              TRIM(
                BOTH
                FROM
                  COALESCE(mp."Work Layer", '' :: text)
              )
            ) = upper(
              TRIM(
                BOTH
                FROM
                  COALESCE(l."LAYERName", '' :: text)
              )
            )
          )
        )
      )
    )
  WHERE
    (
      lower(
        TRIM(
          BOTH
          FROM
            (om."Billable") :: text
        )
      ) = ANY (
        ARRAY ['true'::text, 'yes'::text, '1'::text, 'billable'::text]
      )
    )
),
calculated AS (
  SELECT
    lb."LayerID",
    lb."Block",
    lb."Application",
    lb."Flat",
    lb."LAYERName",
    lb."ID",
    lb."Related Backends",
    lb."Projection Order",
    lb."Projection Work Mode",
    lb."Billable Layer Order",
    lb."Billable",
    lb.total_area,
    lb.done_area,
    lb.material_name,
    lb.material_coverage,
    lb.material_rate,
    GREATEST((lb.total_area - lb.done_area), (0) :: numeric) AS remaining_area,
    CASE
      WHEN (lb.total_area > (0) :: numeric) THEN ((lb.done_area / lb.total_area) * (100) :: numeric)
      ELSE (0) :: numeric
    END AS work_done_pct
  FROM
    layer_base lb
)
SELECT
  "LayerID",
  "Block",
  "Application",
  "Flat",
  "LAYERName",
  "ID",
  "Related Backends",
  "Projection Order",
  "Billable Layer Order",
  "Billable",
  "Projection Work Mode",
  round(total_area, 2) AS "Projection Total Area",
  round(done_area, 2) AS "Projection Done Area",
  round(remaining_area, 2) AS "Remaining Area",
  round(work_done_pct, 2) AS "Work Done Pct",
  material_name AS "Material Name",
  round(
    CASE
      WHEN (material_coverage > (0) :: numeric) THEN (remaining_area / material_coverage)
      ELSE (0) :: numeric
    END,
    2
  ) AS "Material Required",
  round(
    CASE
      WHEN (material_coverage > (0) :: numeric) THEN (
        (remaining_area / material_coverage) * material_rate
      )
      ELSE (0) :: numeric
    END,
    2
  ) AS "Material Cost"
FROM
  calculated c;