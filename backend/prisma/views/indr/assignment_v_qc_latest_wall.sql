WITH qc_wall AS (
  SELECT
    q.qc_id,
    q.block,
    q.application,
    q.flat,
    q.layer_id,
    q.layer AS layer_name,
    q.layer_order,
    TRIM(
      BOTH
      FROM
        w.wall_name
    ) AS wall_name,
    q.qc_date,
    COALESCE(q.result, q.qc_status) AS qc_result,
    q.remark,
    row_number() OVER (
      PARTITION BY (indr.norm_text(q.application)),
      (indr.norm_text(q.flat)),
      (indr.norm_text(COALESCE(q.layer_id, '' :: text))),
      (indr.norm_text(q.layer)),
      (
        indr.norm_text(
          TRIM(
            BOTH
            FROM
              w.wall_name
          )
        )
      )
      ORDER BY
        q.qc_date DESC NULLS LAST,
        q.qc_id DESC
    ) AS rn
  FROM
    (
      indr.indr_qc q
      CROSS JOIN LATERAL regexp_split_to_table(
        COALESCE(q.wall_names, '' :: text),
        '\s*,\s*' :: text
      ) w(wall_name)
    )
  WHERE
    (
      TRIM(
        BOTH
        FROM
          w.wall_name
      ) <> '' :: text
    )
)
SELECT
  qc_id,
  block,
  application,
  flat,
  layer_id,
  layer_name,
  layer_order,
  wall_name,
  qc_date,
  qc_result,
  remark,
  rn
FROM
  qc_wall
WHERE
  (rn = 1);