SELECT
  md5(
    (
      (
        (
          (
            (
              'HourBased|' :: text || COALESCE(h.application, '' :: text)
            ) || '|' :: text
          ) || COALESCE(h.flat, '' :: text)
        ) || '|' :: text
      ) || COALESCE(h.layer_id, '' :: text)
    )
  ) AS source_id,
  md5(
    (
      (
        (
          (
            (
              'HourBasedRow|' :: text || COALESCE(h.application, '' :: text)
            ) || '|' :: text
          ) || COALESCE(h.flat, '' :: text)
        ) || '|' :: text
      ) || COALESCE(h.layer_id, '' :: text)
    )
  ) AS source_wall_id,
  CASE
    WHEN (h.reported_hours > (0) :: numeric) THEN 'Ongoing' :: text
    ELSE 'Next Layer Ready' :: text
  END AS section,
  CASE
    WHEN (h.reported_hours > (0) :: numeric) THEN 2
    ELSE 4
  END AS priority_rank,
  'hour_based_layer' :: text AS source_table,
  h.block,
  h.application,
  h.flat,
  h.layer_id,
  h.layer_name,
  NULL :: text AS surface_type,
  COALESCE(l."order", (999) :: numeric) AS layer_order,
  COALESCE(l.billable, false) AS billable,
  '__HOUR_BASED__' :: text AS wall_name,
  h.remaining_hours AS wall_area,
  h.remaining_hours AS remaining_area,
  NULL :: date AS oldest_date,
  'Available' :: text AS eligibility_status,
  NULL :: text AS risk_reason,
  TRUE AS is_hour_based,
  h.total_hours,
  h.reported_hours,
  h.remaining_hours
FROM
  (
    indr.assignment_v_hour_layer_status h
    JOIN indr.layer l ON ((l.layer_id = h.layer_id))
  )
WHERE
  (h.remaining_hours > (0) :: numeric);