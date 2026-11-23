WITH raw_sources AS (
  SELECT
    to_jsonb(r.*) AS row_data,
    'Rollover' :: text AS default_section,
    1 AS default_priority,
    'assignment_v_rollover' :: text AS default_source_table
  FROM
    indr.assignment_v_rollover r
  UNION
  ALL
  SELECT
    to_jsonb(o.*) AS row_data,
    'Ongoing' :: text AS default_section,
    2 AS default_priority,
    'assignment_v_ongoing' :: text AS default_source_table
  FROM
    indr.assignment_v_ongoing o
  UNION
  ALL
  SELECT
    to_jsonb(q.*) AS row_data,
    'QC Rework' :: text AS default_section,
    3 AS default_priority,
    'assignment_v_qc_rework' :: text AS default_source_table
  FROM
    indr.assignment_v_qc_rework q
  UNION
  ALL
  SELECT
    to_jsonb(n.*) AS row_data,
    'Next Layer Ready' :: text AS default_section,
    4 AS default_priority,
    'assignment_v_new_layer' :: text AS default_source_table
  FROM
    indr.assignment_v_new_layer n
  UNION
  ALL
  SELECT
    to_jsonb(h.*) AS row_data,
    h.section AS default_section,
    h.priority_rank AS default_priority,
    'assignment_v_hour_based_demand' :: text AS default_source_table
  FROM
    indr.assignment_v_hour_based_demand h
),
standardized AS (
  SELECT
    COALESCE(
      (raw_sources.row_data ->> 'section' :: text),
      raw_sources.default_section
    ) AS section,
    COALESCE(
      (
        NULLIF(
          (raw_sources.row_data ->> 'priority_rank' :: text),
          '' :: text
        )
      ) :: integer,
      raw_sources.default_priority
    ) AS priority_rank,
    COALESCE(
      (raw_sources.row_data ->> 'source_table' :: text),
      raw_sources.default_source_table
    ) AS source_table,
    NULLIF(
      (raw_sources.row_data ->> 'source_id' :: text),
      '' :: text
    ) AS raw_source_id,
    NULLIF(
      (raw_sources.row_data ->> 'source_wall_id' :: text),
      '' :: text
    ) AS raw_source_wall_id,
    NULLIF(
      (raw_sources.row_data ->> 'block' :: text),
      '' :: text
    ) AS block,
    NULLIF(
      (raw_sources.row_data ->> 'application' :: text),
      '' :: text
    ) AS application,
    NULLIF(
      (raw_sources.row_data ->> 'flat' :: text),
      '' :: text
    ) AS flat,
    NULLIF(
      (raw_sources.row_data ->> 'layer_id' :: text),
      '' :: text
    ) AS layer_id,
    NULLIF(
      (raw_sources.row_data ->> 'layer_name' :: text),
      '' :: text
    ) AS layer_name,
    NULLIF(
      (raw_sources.row_data ->> 'surface_type' :: text),
      '' :: text
    ) AS surface_type,
    NULLIF(
      (raw_sources.row_data ->> 'wall_name' :: text),
      '' :: text
    ) AS wall_name,
    indr.safe_numeric(
      COALESCE(
        (raw_sources.row_data ->> 'wall_area' :: text),
        (raw_sources.row_data ->> 'assigned_area' :: text),
        (raw_sources.row_data ->> 'remaining_area' :: text),
        (raw_sources.row_data ->> 'area' :: text)
      )
    ) AS wall_area,
    indr.safe_numeric(
      COALESCE(
        (raw_sources.row_data ->> 'remaining_area' :: text),
        (raw_sources.row_data ->> 'pending_area' :: text),
        (raw_sources.row_data ->> 'wall_area' :: text),
        (raw_sources.row_data ->> 'assigned_area' :: text),
        (raw_sources.row_data ->> 'area' :: text)
      )
    ) AS remaining_area,
    CASE
      WHEN (
        NULLIF(
          (raw_sources.row_data ->> 'oldest_date' :: text),
          '' :: text
        ) IS NOT NULL
      ) THEN ((raw_sources.row_data ->> 'oldest_date' :: text)) :: date
      WHEN (
        NULLIF(
          (raw_sources.row_data ->> 'assignment_date' :: text),
          '' :: text
        ) IS NOT NULL
      ) THEN (
        (raw_sources.row_data ->> 'assignment_date' :: text)
      ) :: date
      WHEN (
        NULLIF(
          (raw_sources.row_data ->> 'work_date' :: text),
          '' :: text
        ) IS NOT NULL
      ) THEN ((raw_sources.row_data ->> 'work_date' :: text)) :: date
      ELSE NULL :: date
    END AS oldest_date,
    COALESCE(
      NULLIF(
        (
          raw_sources.row_data ->> 'eligibility_status' :: text
        ),
        '' :: text
      ),
      'Available' :: text
    ) AS eligibility_status,
    NULLIF(
      (raw_sources.row_data ->> 'risk_reason' :: text),
      '' :: text
    ) AS risk_reason,
    CASE
      WHEN (
        indr.norm_text((raw_sources.row_data ->> 'is_hour_based' :: text)) = ANY (
          ARRAY ['TRUE'::text, 'T'::text, '1'::text, 'YES'::text]
        )
      ) THEN TRUE
      ELSE false
    END AS is_hour_based,
    indr.safe_numeric((raw_sources.row_data ->> 'total_hours' :: text)) AS total_hours,
    indr.safe_numeric(
      (raw_sources.row_data ->> 'reported_hours' :: text)
    ) AS reported_hours,
    indr.safe_numeric(
      (raw_sources.row_data ->> 'remaining_hours' :: text)
    ) AS remaining_hours
  FROM
    raw_sources
),
enriched AS (
  SELECT
    s.section,
    s.priority_rank,
    s.source_table,
    s.raw_source_id,
    s.raw_source_wall_id,
    s.block,
    s.application,
    s.flat,
    s.layer_id,
    s.layer_name,
    s.surface_type,
    s.wall_name,
    s.wall_area,
    s.remaining_area,
    s.oldest_date,
    s.eligibility_status,
    s.risk_reason,
    s.is_hour_based,
    s.total_hours,
    s.reported_hours,
    s.remaining_hours,
    COALESCE(l1.layer_id, l2.layer_id, s.layer_id) AS resolved_layer_id,
    COALESCE(l1.layer_name, l2.layer_name, s.layer_name) AS resolved_layer_name,
    COALESCE(l1."order", l2."order", (999) :: numeric) AS resolved_layer_order,
    COALESCE(l1.billable, l2.billable, false) AS resolved_billable,
    (
      s.is_hour_based
      OR indr.assignment_is_hour_based_layer(
        COALESCE(l1.layer_name, l2.layer_name, s.layer_name)
      )
    ) AS resolved_is_hour_based
  FROM
    (
      (
        standardized s
        LEFT JOIN indr.layer l1 ON ((l1.layer_id = s.layer_id))
      )
      LEFT JOIN indr.layer l2 ON (
        (
          (
            indr.norm_text(l2.application) = indr.norm_text(s.application)
          )
          AND (
            (
              indr.norm_text(l2.flat_id) = indr.norm_text(s.flat)
            )
            OR (
              regexp_replace(
                COALESCE(l2.flat_id, '' :: text),
                '\D' :: text,
                '' :: text,
                'g' :: text
              ) = regexp_replace(
                COALESCE(s.flat, '' :: text),
                '\D' :: text,
                '' :: text,
                'g' :: text
              )
            )
          )
          AND (
            indr.norm_text(l2.layer_name) = indr.norm_text(s.layer_name)
          )
        )
      )
    )
),
cleaned AS (
  SELECT
    COALESCE(
      enriched.raw_source_id,
      md5(
        (
          (
            (
              (
                (
                  (
                    (
                      (
                        (
                          (
                            (
                              (
                                COALESCE(enriched.section, '' :: text) || '|' :: text
                              ) || COALESCE(enriched.application, '' :: text)
                            ) || '|' :: text
                          ) || COALESCE(enriched.flat, '' :: text)
                        ) || '|' :: text
                      ) || COALESCE(enriched.resolved_layer_id, '' :: text)
                    ) || '|' :: text
                  ) || COALESCE(enriched.resolved_layer_name, '' :: text)
                ) || '|' :: text
              ) || COALESCE(enriched.surface_type, '' :: text)
            ) || '|' :: text
          ) || COALESCE(enriched.wall_name, '' :: text)
        )
      )
    ) AS source_id,
    COALESCE(
      enriched.raw_source_wall_id,
      md5(
        (
          (
            (
              (
                (
                  (
                    (
                      (
                        (
                          (
                            COALESCE(enriched.section, '' :: text) || '|' :: text
                          ) || COALESCE(enriched.application, '' :: text)
                        ) || '|' :: text
                      ) || COALESCE(enriched.flat, '' :: text)
                    ) || '|' :: text
                  ) || COALESCE(enriched.resolved_layer_id, '' :: text)
                ) || '|' :: text
              ) || COALESCE(enriched.surface_type, '' :: text)
            ) || '|' :: text
          ) || COALESCE(enriched.wall_name, '' :: text)
        )
      )
    ) AS source_wall_id,
    enriched.section,
    enriched.priority_rank,
    enriched.source_table,
    enriched.block,
    enriched.application,
    enriched.flat,
    enriched.resolved_layer_id AS layer_id,
    enriched.resolved_layer_name AS layer_name,
    enriched.surface_type,
    enriched.resolved_layer_order AS layer_order,
    enriched.resolved_billable AS billable,
    enriched.wall_name,
    enriched.wall_area,
    enriched.remaining_area,
    enriched.oldest_date,
    enriched.eligibility_status,
    enriched.risk_reason,
    enriched.resolved_is_hour_based AS is_hour_based,
    enriched.total_hours,
    enriched.reported_hours,
    enriched.remaining_hours
  FROM
    enriched
  WHERE
    (
      (enriched.application IS NOT NULL)
      AND (enriched.flat IS NOT NULL)
      AND (enriched.resolved_layer_id IS NOT NULL)
      AND (enriched.resolved_layer_name IS NOT NULL)
      AND (
        COALESCE(enriched.remaining_area, (0) :: numeric) > (0) :: numeric
      )
      AND (
        (enriched.source_table = 'hour_based_layer' :: text)
        OR (
          enriched.source_table = 'assignment_v_hour_based_demand' :: text
        )
        OR (
          NOT indr.assignment_is_hour_based_layer(enriched.resolved_layer_name)
        )
      )
    )
),
ranked AS (
  SELECT
    cleaned.source_id,
    cleaned.source_wall_id,
    cleaned.section,
    cleaned.priority_rank,
    cleaned.source_table,
    cleaned.block,
    cleaned.application,
    cleaned.flat,
    cleaned.layer_id,
    cleaned.layer_name,
    cleaned.surface_type,
    cleaned.layer_order,
    cleaned.billable,
    cleaned.wall_name,
    cleaned.wall_area,
    cleaned.remaining_area,
    cleaned.oldest_date,
    cleaned.eligibility_status,
    cleaned.risk_reason,
    cleaned.is_hour_based,
    cleaned.total_hours,
    cleaned.reported_hours,
    cleaned.remaining_hours,
    row_number() OVER (
      PARTITION BY (indr.norm_text(cleaned.application)),
      (indr.norm_text(cleaned.flat)),
      (indr.norm_text(cleaned.layer_id)),
      (indr.norm_text(cleaned.layer_name)),
      (
        indr.norm_text(COALESCE(cleaned.surface_type, '' :: text))
      ),
      (
        indr.norm_text(COALESCE(cleaned.wall_name, '' :: text))
      )
      ORDER BY
        cleaned.priority_rank,
        cleaned.oldest_date
    ) AS rn
  FROM
    cleaned
)
SELECT
  source_id,
  source_wall_id,
  section,
  priority_rank,
  source_table,
  block,
  application,
  flat,
  layer_id,
  layer_name,
  surface_type,
  layer_order,
  billable,
  wall_name,
  wall_area,
  remaining_area,
  oldest_date,
  eligibility_status,
  risk_reason,
  is_hour_based,
  total_hours,
  reported_hours,
  remaining_hours
FROM
  ranked
WHERE
  (rn = 1);