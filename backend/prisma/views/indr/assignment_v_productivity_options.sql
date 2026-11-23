SELECT
  application,
  layer_name,
  machine_or_manual,
  productivity_per_hour
FROM
  indr.assignment_v_productivity
WHERE
  (
    COALESCE(productivity_per_hour, (0) :: numeric) > (0) :: numeric
  )
ORDER BY
  application,
  layer_name,
  CASE
    indr.norm_text(machine_or_manual)
    WHEN 'MACHINE' :: text THEN 1
    WHEN 'MANUAL' :: text THEN 2
    WHEN 'BOTH' :: text THEN 3
    ELSE 4
  END;