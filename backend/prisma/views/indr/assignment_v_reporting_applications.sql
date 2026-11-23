SELECT
  DISTINCT block,
  application
FROM
  indr.surface_number
WHERE
  (
    (
      NULLIF(
        TRIM(
          BOTH
          FROM
            COALESCE(block, '' :: text)
        ),
        '' :: text
      ) IS NOT NULL
    )
    AND (
      NULLIF(
        TRIM(
          BOTH
          FROM
            COALESCE(application, '' :: text)
        ),
        '' :: text
      ) IS NOT NULL
    )
  )
ORDER BY
  block,
  application;