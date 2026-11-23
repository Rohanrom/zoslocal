SELECT
  row_type,
  section_title,
  floor_label,
  floor_no,
  layer_name,
  unit,
  round(sum(ceiling_area), 2) AS total_ceiling_area,
  round(sum(wall_area), 2) AS total_wall_area,
  round(sum(total_area), 2) AS total_area,
  max(latest_row_batch_no) AS latest_batch_no,
  bool_or(is_latest_batch) AS has_latest_batch_rows,
  string_agg(
    DISTINCT description,
    ' & ' :: text
    ORDER BY
      description
  ) AS included_descriptions
FROM
  indr.v_billing_floor_layer_detail
GROUP BY
  row_type,
  section_title,
  floor_label,
  floor_no,
  layer_name,
  unit;