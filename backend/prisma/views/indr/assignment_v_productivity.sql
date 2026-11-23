SELECT
  productivity_id,
  application,
  work_layer AS layer_name,
  machine_or_manual,
  COALESCE(ideal_productivity_sqft_hr, (0) :: numeric) AS productivity_per_hour
FROM
  indr.productivity_master pm;