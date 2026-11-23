WITH reported_by_layer AS (
  SELECT
    COALESCE(l_1.layer_id, b.layer_id) AS layer_id,
    sum(
      (
        COALESCE(b.working_hours, (0) :: numeric) * (
          GREATEST(
            COALESCE(
              cardinality(
                regexp_split_to_array(
                  NULLIF(
                    TRIM(
                      BOTH
                      FROM
                        COALESCE(b.painter_names, '' :: text)
                    ),
                    '' :: text
                  ),
                  '\s*,\s*' :: text
                )
              ),
              1
            ),
            1
          )
        ) :: numeric
      )
    ) AS reported_hours
  FROM
    (
      indr.backend b
      LEFT JOIN indr.layer l_1 ON (
        (
          (
            indr.norm_text(l_1.application) = indr.norm_text(b.application)
          )
          AND (
            (
              indr.norm_text(l_1.flat_id) = indr.norm_text(b.flat)
            )
            OR (
              regexp_replace(
                COALESCE(l_1.flat_id, '' :: text),
                '\D' :: text,
                '' :: text,
                'g' :: text
              ) = regexp_replace(
                COALESCE(b.flat, '' :: text),
                '\D' :: text,
                '' :: text,
                'g' :: text
              )
            )
          )
          AND (
            (
              indr.norm_text(COALESCE(b.layer_id, '' :: text)) = indr.norm_text(l_1.layer_id)
            )
            OR (
              indr.norm_text(COALESCE(b.work_layer, '' :: text)) = indr.norm_text(l_1.layer_name)
            )
          )
        )
      )
    )
  WHERE
    (
      (
        indr.norm_text(COALESCE(b.work_status, '' :: text)) = 'DONE' :: text
      )
      AND indr.assignment_is_hour_based_layer(COALESCE(l_1.layer_name, b.work_layer))
    )
  GROUP BY
    COALESCE(l_1.layer_id, b.layer_id)
)
SELECT
  l.layer_id,
  l.block,
  l.application,
  l.flat_id AS flat,
  l.layer_name,
  (24) :: numeric AS total_hours,
  COALESCE(r.reported_hours, (0) :: numeric) AS reported_hours,
  GREATEST(
    (
      (24) :: numeric - COALESCE(r.reported_hours, (0) :: numeric)
    ),
    (0) :: numeric
  ) AS remaining_hours,
  LEAST(
    round(
      (
        (
          COALESCE(r.reported_hours, (0) :: numeric) / (24) :: numeric
        ) * (100) :: numeric
      ),
      2
    ),
    (100) :: numeric
  ) AS wkdpct
FROM
  (
    indr.layer l
    LEFT JOIN reported_by_layer r ON ((r.layer_id = l.layer_id))
  )
WHERE
  indr.assignment_is_hour_based_layer(l.layer_name);