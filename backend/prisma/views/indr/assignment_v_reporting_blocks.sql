SELECT
  DISTINCT block
FROM
  indr.surface_number
WHERE
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
ORDER BY
  block;