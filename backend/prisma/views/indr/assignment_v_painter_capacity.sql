SELECT
  availability_date,
  site,
  count(*) FILTER (
    WHERE
      (
        indr.norm_text(availability_status) = ANY (
          ARRAY ['AVAILABLE'::text, 'PARTIALLY AVAILABLE'::text]
        )
      )
  ) AS available_painter_count,
  sum(
    CASE
      WHEN (
        indr.norm_text(availability_status) = ANY (
          ARRAY ['AVAILABLE'::text, 'PARTIALLY AVAILABLE'::text]
        )
      ) THEN COALESCE(available_hours, (0) :: numeric)
      ELSE (0) :: numeric
    END
  ) AS available_hours
FROM
  indr.painter_availability pa
GROUP BY
  availability_date,
  site;