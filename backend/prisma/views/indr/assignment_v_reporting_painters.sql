SELECT
  painter_id,
  painter_name,
  current_site,
  category,
  daily_wage,
  STATUS
FROM
  indr.all_site_painter_master
WHERE
  (
    (
      indr.norm_text(current_site) = ANY (ARRAY ['INDRADHANUSH'::text, 'INDR'::text])
    )
    AND (
      indr.norm_text(STATUS) = ANY (
        ARRAY ['ACTIVE'::text, 'AVAILABLE'::text, ''::text]
      )
    )
  );