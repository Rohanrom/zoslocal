SELECT
  l.layer_id,
  l.block,
  l.application,
  l.flat_id AS flat,
  l.layer_name,
  COALESCE(l."order", (999) :: numeric) AS layer_order,
  CASE
    WHEN (
      regexp_replace(
        COALESCE(l.flat_id, '' :: text),
        '\D' :: text,
        '' :: text,
        'g' :: text
      ) ~ '^[0-9]+$' :: text
    ) THEN (
      regexp_replace(
        COALESCE(l.flat_id, '' :: text),
        '\D' :: text,
        '' :: text,
        'g' :: text
      )
    ) :: numeric
    ELSE (999999) :: numeric
  END AS flat_sort,
  CASE
    WHEN (
      COALESCE(l."order", (999) :: numeric) = (999) :: numeric
    ) THEN 1
    ELSE 0
  END AS no_order_flag,
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