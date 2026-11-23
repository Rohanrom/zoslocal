SELECT
  surface_id,
  block,
  application,
  base AS flat_id,
  base AS flat,
  wall AS wall_name,
  CASE
    WHEN (
      lower(
        TRIM(
          BOTH
          FROM
            COALESCE(surface_type, '' :: text)
        )
      ) = 'ceiling' :: text
    ) THEN 'Ceiling' :: text
    WHEN (
      lower(
        TRIM(
          BOTH
          FROM
            COALESCE(surface_type, '' :: text)
        )
      ) = 'wall' :: text
    ) THEN 'Wall' :: text
    WHEN (upper(COALESCE(wall, '' :: text)) ~~ 'C%' :: text) THEN 'Ceiling' :: text
    WHEN (
      upper(COALESCE(wall, '' :: text)) ~~ '%CEILING%' :: text
    ) THEN 'Ceiling' :: text
    ELSE 'Wall' :: text
  END AS surface_type,
  COALESCE(total_area_sft, (0) :: numeric) AS wall_area
FROM
  indr.surface_number sn
WHERE
  (
    NULLIF(
      TRIM(
        BOTH
        FROM
          COALESCE(wall, '' :: text)
      ),
      '' :: text
    ) IS NOT NULL
  );