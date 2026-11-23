SELECT
  DISTINCT block,
  application,
  base AS flat
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
    AND (
      NULLIF(
        TRIM(
          BOTH
          FROM
            COALESCE(base, '' :: text)
        ),
        '' :: text
      ) IS NOT NULL
    )
  )
ORDER BY
  block,
  application,
  base;