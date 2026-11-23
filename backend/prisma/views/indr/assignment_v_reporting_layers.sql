SELECT
  l.block,
  l.application,
  l.flat_id AS flat,
  l.layer_id,
  l.layer_name,
  COALESCE(l."order", (999) :: numeric) AS layer_order,
  CASE
    WHEN indr.assignment_is_hour_based_layer(l.layer_name) THEN COALESCE(h.wkdpct, (0) :: numeric)
    ELSE COALESCE(l.wkdpct, (0) :: numeric)
  END AS wkdpct,
  indr.assignment_is_hour_based_layer(l.layer_name) AS is_hour_based,
  h.total_hours,
  h.reported_hours,
  h.remaining_hours
FROM
  (
    indr.layer l
    LEFT JOIN indr.assignment_v_hour_layer_status h ON ((h.layer_id = l.layer_id))
  )
WHERE
  (
    (l.application IS NOT NULL)
    AND (l.flat_id IS NOT NULL)
    AND (l.layer_name IS NOT NULL)
  );