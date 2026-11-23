


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "indr";


ALTER SCHEMA "indr" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "indr"."approve_billing_row"("p_id" "text") RETURNS TABLE("id" "text", "Application" "text", "Flat" "text", "Surface Type" "text", "Layer Name" "text", "Billed" boolean, "Billing Number" "text", "Billing Date" "date", "Rate" numeric, "Billing Area" numeric, "Status" "text", "Batch no." integer, "WorkDonePct" numeric, "Is Complete" boolean, "Can Billed" boolean, "Batch" "text")
    LANGUAGE "plpgsql"
    AS $$
declare
  v_next_batch_no integer;
  v_batch_label text;
  v_billing_number text;
begin

  select
    coalesce(
      max(indr.get_tracker_batch_no(t."Batch no.", t."Batch")),
      0
    ) + 1
  into v_next_batch_no
  from indr.billing_tracker_indr t;

  v_batch_label := 'B' || v_next_batch_no::text;

  v_billing_number :=
    'INV-' ||
    to_char(current_date, 'YYMMDD') ||
    '-' ||
    substring(md5(p_id || now()::text), 1, 4);

  update indr.billing_tracker_indr t
  set
    "Status" = 'Approved',
    "Billed" = true,
    "Billing Date" = current_date,
    "Billing Number" = coalesce(
      nullif(t."Billing Number", ''),
      v_billing_number
    ),
    "Batch no." = v_next_batch_no,
    "Batch" = v_batch_label,
    "Can Billed" = false
  where t.id = p_id
    and coalesce(t."Billed", false) = false
    and upper(trim(coalesce(t."Status", ''))) = 'SENT';

  perform indr.refresh_billing_batch_data_core();

  return query
  select
    t.id,
    t."Application",
    t."Flat",
    t."Surface Type",
    t."Layer Name",
    t."Billed",
    t."Billing Number",
    t."Billing Date",
    t."Rate",
    t."Billing Area",
    t."Status",
    t."Batch no.",
    t."WorkDonePct",
    t."Is Complete",
    t."Can Billed",
    t."Batch"
  from indr.billing_tracker_indr t
  where t.id = p_id;

end;
$$;


ALTER FUNCTION "indr"."approve_billing_row"("p_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "indr"."approve_billing_rows"("p_ids" "text"[]) RETURNS TABLE("id" "text", "Application" "text", "Flat" "text", "Surface Type" "text", "Layer Name" "text", "Billed" boolean, "Billing Number" "text", "Billing Date" "date", "Rate" numeric, "Billing Area" numeric, "Status" "text", "Batch no." integer, "WorkDonePct" numeric, "Is Complete" boolean, "Can Billed" boolean, "Batch" "text")
    LANGUAGE "plpgsql"
    AS $$
declare
  v_billing_date date := current_date;
  v_batch_no integer;
  v_batch_label text;
begin

  v_batch_no := indr.get_or_create_batch_no_for_date(v_billing_date);
  v_batch_label := 'B' || v_batch_no::text;

  update indr.billing_tracker_indr t
  set
    "Status" = 'Approved',
    "Billed" = true,
    "Billing Date" = v_billing_date,
    "Billing Number" = coalesce(
      nullif(t."Billing Number", ''),
      'INV-' ||
      to_char(v_billing_date, 'YYMMDD') ||
      '-' ||
      substring(md5(t.id || now()::text), 1, 4)
    ),
    "Batch no." = v_batch_no,
    "Batch" = v_batch_label,
    "Can Billed" = false
  where t.id = any(p_ids)
    and coalesce(t."Billed", false) = false
    and upper(trim(coalesce(t."Status", ''))) = 'SENT';

  perform indr.refresh_billing_batch_data_core();

  return query
  select
    t.id,
    t."Application",
    t."Flat",
    t."Surface Type",
    t."Layer Name",
    t."Billed",
    t."Billing Number",
    t."Billing Date",
    t."Rate",
    t."Billing Area",
    t."Status",
    t."Batch no.",
    t."WorkDonePct",
    t."Is Complete",
    t."Can Billed",
    t."Batch"
  from indr.billing_tracker_indr t
  where t.id = any(p_ids)
  order by
    t."Application",
    t."Flat",
    t."Surface Type",
    t."Layer Name";

end;
$$;


ALTER FUNCTION "indr"."approve_billing_rows"("p_ids" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "indr"."batch_label_to_no"("batch_label" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select nullif(
    regexp_replace(coalesce(batch_label, ''), '[^0-9]', '', 'g'),
    ''
  )::integer;
$$;


ALTER FUNCTION "indr"."batch_label_to_no"("batch_label" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "indr"."get_invoice_table"("p_batch_no" integer) RETURNS TABLE("Sl No" numeric, "Description of the work" "text", "Surface" "text", "Unit" "text", "Rate" numeric, "Quantity Previous" numeric, "Quantity Current" numeric, "Quantity Cumulative" numeric, "Amount Previous" numeric, "Amount Current" numeric, "Amount Cumulative" numeric)
    LANGUAGE "sql" STABLE
    AS $$

  with batch_unpivot as (

    select
      b."Flat",
      x.layer_name,
      x.surface,
      x.batch_label,
      indr.batch_label_to_no(x.batch_label) as batch_no,

      case
        when x.surface = 'Ceiling'
        then coalesce(fa."Ceiling Area", 0)
        when x.surface = 'Wall'
        then coalesce(fa."Wall Area", 0)
        else 0
      end as area

    from indr.billing_batch_data b

    left join indr.flat_area fa
      on fa."Flat" = b."Flat"

    cross join lateral (
      values
        ('1st Fine Putty',  'Ceiling', b."1st Fine Putty Ceiling"),
        ('1st Fine Putty',  'Wall',    b."1st Fine Putty Wall"),

        ('2nd Fine Putty',  'Ceiling', b."2nd Fine Putty Ceiling"),
        ('2nd Fine Putty',  'Wall',    b."2nd Fine Putty Wall"),

        ('1st Coat Primer', 'Ceiling', b."1st Coat Primer Ceiling"),
        ('1st Coat Primer', 'Wall',    b."1st Coat Primer Wall"),

        ('1st Coat Paint',  'Ceiling', b."1st Coat Paint Ceiling"),
        ('1st Coat Paint',  'Wall',    b."1st Coat Paint Wall"),

        ('2nd Coat Paint',  'Ceiling', b."2nd Coat Paint Ceiling"),
        ('2nd Coat Paint',  'Wall',    b."2nd Coat Paint Wall")
    ) as x(layer_name, surface, batch_label)

    where nullif(trim(coalesce(x.batch_label, '')), '') is not null
  ),

  qty_summary as (
    select
      layer_name,
      surface,

      round(
        sum(area) filter (
          where batch_no < p_batch_no
        ),
        2
      ) as qty_previous,

      round(
        sum(area) filter (
          where batch_no = p_batch_no
        ),
        2
      ) as qty_current,

      round(
        sum(area) filter (
          where batch_no <= p_batch_no
        ),
        2
      ) as qty_cumulative

    from batch_unpivot
    where batch_no is not null
    group by
      layer_name,
      surface
  )

  select
    i."Sl No",
    i."Description of the work",
    i."Surface",
    i."Unit",
    i."Rate",

    coalesce(q.qty_previous, 0) as "Quantity Previous",
    coalesce(q.qty_current, 0) as "Quantity Current",
    coalesce(q.qty_cumulative, 0) as "Quantity Cumulative",

    round(coalesce(q.qty_previous, 0) * i."Rate", 2) as "Amount Previous",
    round(coalesce(q.qty_current, 0) * i."Rate", 2) as "Amount Current",
    round(coalesce(q.qty_cumulative, 0) * i."Rate", 2) as "Amount Cumulative"

  from indr.invoice_table i

  left join qty_summary q
    on q.layer_name = i."Layer Name"
   and q.surface = i."Surface"

  order by
    i."Sl No";

$$;


ALTER FUNCTION "indr"."get_invoice_table"("p_batch_no" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "indr"."get_or_create_batch_no_for_date"("p_billing_date" "date" DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
declare
  v_existing_batch_no integer;
  v_next_batch_no integer;
begin

  -- Check if any approved/billed row already exists for this billing date.
  select
    max(indr.get_tracker_batch_no(t."Batch no.", t."Batch"))
  into v_existing_batch_no
  from indr.billing_tracker_indr t
  where t."Billing Date" = p_billing_date
    and indr.get_tracker_batch_no(t."Batch no.", t."Batch") is not null
    and (
      coalesce(t."Billed", false) = true
      or upper(trim(coalesce(t."Status", ''))) = 'APPROVED'
    );

  if v_existing_batch_no is not null then
    return v_existing_batch_no;
  end if;

  -- If no batch exists today, create next batch number.
  select
    coalesce(
      max(indr.get_tracker_batch_no(t."Batch no.", t."Batch")),
      0
    ) + 1
  into v_next_batch_no
  from indr.billing_tracker_indr t;

  return v_next_batch_no;

end;
$$;


ALTER FUNCTION "indr"."get_or_create_batch_no_for_date"("p_billing_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "indr"."get_tracker_batch_no"("batch_no" integer, "batch_text" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select coalesce(
    batch_no,
    indr.batch_label_to_no(batch_text)
  );
$$;


ALTER FUNCTION "indr"."get_tracker_batch_no"("batch_no" integer, "batch_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "indr"."refresh_billing_batch_data_core"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin

  truncate table indr.billing_batch_data;

  insert into indr.billing_batch_data (
    "Flat",

    "1st Fine Putty Ceiling",
    "1st Fine Putty Wall",

    "2nd Fine Putty Ceiling",
    "2nd Fine Putty Wall",

    "1st Coat Primer Ceiling",
    "1st Coat Primer Wall",

    "1st Coat Paint Ceiling",
    "1st Coat Paint Wall",

    "2nd Coat Paint Ceiling",
    "2nd Coat Paint Wall"
  )

  with all_flats as (
    select distinct "Flat"
    from indr.billing_tracker_indr
    where "Flat" is not null

    union

    select distinct "Flat"
    from indr.flat_area
    where "Flat" is not null
  ),

  source_data as (
    select
      t."Flat",
      t."Layer Name",
      t."Surface Type",
      t."Batch",
      indr.get_tracker_batch_no(t."Batch no.", t."Batch") as batch_no
    from indr.billing_tracker_indr t
    where nullif(trim(coalesce(t."Batch", '')), '') is not null
       or t."Batch no." is not null
  ),

  latest_data as (
    select
      "Flat",
      "Layer Name",
      "Surface Type",
      'B' || max(batch_no)::text as batch_label
    from source_data
    where batch_no is not null
    group by
      "Flat",
      "Layer Name",
      "Surface Type"
  )

  select
    f."Flat",

    max(batch_label) filter (
      where "Layer Name" = '1st Fine Putty'
        and "Surface Type" = 'Ceiling'
    ) as "1st Fine Putty Ceiling",

    max(batch_label) filter (
      where "Layer Name" = '1st Fine Putty'
        and "Surface Type" = 'Wall'
    ) as "1st Fine Putty Wall",

    max(batch_label) filter (
      where "Layer Name" = '2nd Fine Putty'
        and "Surface Type" = 'Ceiling'
    ) as "2nd Fine Putty Ceiling",

    max(batch_label) filter (
      where "Layer Name" = '2nd Fine Putty'
        and "Surface Type" = 'Wall'
    ) as "2nd Fine Putty Wall",

    max(batch_label) filter (
      where "Layer Name" = '1st Coat Primer'
        and "Surface Type" = 'Ceiling'
    ) as "1st Coat Primer Ceiling",

    max(batch_label) filter (
      where "Layer Name" = '1st Coat Primer'
        and "Surface Type" = 'Wall'
    ) as "1st Coat Primer Wall",

    max(batch_label) filter (
      where "Layer Name" = '1st Coat Paint'
        and "Surface Type" = 'Ceiling'
    ) as "1st Coat Paint Ceiling",

    max(batch_label) filter (
      where "Layer Name" = '1st Coat Paint'
        and "Surface Type" = 'Wall'
    ) as "1st Coat Paint Wall",

    max(batch_label) filter (
      where "Layer Name" = '2nd Coat Paint'
        and "Surface Type" = 'Ceiling'
    ) as "2nd Coat Paint Ceiling",

    max(batch_label) filter (
      where "Layer Name" = '2nd Coat Paint'
        and "Surface Type" = 'Wall'
    ) as "2nd Coat Paint Wall"

  from all_flats f
  left join latest_data d
    on d."Flat" = f."Flat"
  group by
    f."Flat"
  order by
    f."Flat";

end;
$$;


ALTER FUNCTION "indr"."refresh_billing_batch_data_core"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "indr"."refresh_billing_batch_data_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  perform indr.refresh_billing_batch_data_core();
  return null;
end;
$$;


ALTER FUNCTION "indr"."refresh_billing_batch_data_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "indr"."send_billing_for_approval"("p_id" "text") RETURNS TABLE("id" "text", "Application" "text", "Flat" "text", "Surface Type" "text", "Layer Name" "text", "Billed" boolean, "Billing Number" "text", "Billing Date" "date", "Rate" numeric, "Billing Area" numeric, "Status" "text", "Batch no." integer, "WorkDonePct" numeric, "Is Complete" boolean, "Can Billed" boolean, "Batch" "text")
    LANGUAGE "plpgsql"
    AS $$
begin

  update indr.billing_tracker_indr t
  set
    "Status" = 'Sent'
  where t.id = p_id
    and coalesce(t."Billed", false) = false
    and coalesce(t."WorkDonePct", 0) >= 1
    and upper(trim(coalesce(t."Status", ''))) = 'NA';

  perform indr.refresh_billing_batch_data_core();

  return query
  select
    t.id,
    t."Application",
    t."Flat",
    t."Surface Type",
    t."Layer Name",
    t."Billed",
    t."Billing Number",
    t."Billing Date",
    t."Rate",
    t."Billing Area",
    t."Status",
    t."Batch no.",
    t."WorkDonePct",
    t."Is Complete",
    t."Can Billed",
    t."Batch"
  from indr.billing_tracker_indr t
  where t.id = p_id;

end;
$$;


ALTER FUNCTION "indr"."send_billing_for_approval"("p_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "indr"."to_numeric_safe"("value" "text") RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  with cleaned as (
    select nullif(
      regexp_replace(coalesce(value, ''), '[^0-9\.\-]', '', 'g'),
      ''
    ) as v
  )
  select
    case
      when v ~ '^-?[0-9]+(\.[0-9]+)?$'
      then v::numeric
      else 0
    end
  from cleaned;
$_$;


ALTER FUNCTION "indr"."to_numeric_safe"("value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_projection_layers_calc"("p_daily_painters" numeric DEFAULT 1, "p_work_mode" "text" DEFAULT NULL::"text") RETURNS TABLE("LayerID" "text", "Block" "text", "Application" "text", "Flat" "text", "LAYERName" "text", "ID" "text", "Related Backends" "text", "Projection Order" integer, "Billable Layer Order" integer, "Billable" boolean, "Selected Work Mode" "text", "Matched Productivity Mode" "text", "Projection Total Area" numeric, "Projection Done Area" numeric, "Remaining Area" numeric, "Work Done Pct" numeric, "Ideal Sqft/Hr/Labour" numeric, "Labour Hours Required" numeric, "Painter Required" numeric, "Daily Painters Input" numeric, "Days Required" numeric, "Material Name" "text", "Material Required" numeric, "Material Cost" numeric)
    LANGUAGE "sql" STABLE
    AS $$
  with base as (
    select
      v.*,
      coalesce(
        nullif(trim(p_work_mode), ''),
        nullif(trim(v."Projection Work Mode"), ''),
        'Both'
      ) as effective_work_mode
    from public.v_projection_layers_billable_base v
  ),

  joined as (
    select
      b.*,
      coalesce(pm.ideal_sqft_hr, 0) as ideal_sqft_hr,
      pm.matched_productivity_mode
    from base b

    left join lateral (
      select
        public.zos_to_numeric(p."Ideal Sqft/Hr/Labour"::text) as ideal_sqft_hr,
        p."Machine or Manual" as matched_productivity_mode
      from public."productivity aph(1)" p
      where upper(trim(coalesce(p."Application", ''))) =
            upper(trim(coalesce(b."Application", '')))
        and upper(trim(coalesce(p."Work Layer", ''))) =
            upper(trim(coalesce(b."LAYERName", '')))
        and (
          upper(trim(coalesce(p."Machine or Manual", ''))) =
          upper(trim(coalesce(b.effective_work_mode, '')))
          or upper(trim(coalesce(p."Machine or Manual", ''))) = 'BOTH'
        )
      order by
        case
          when upper(trim(coalesce(p."Machine or Manual", ''))) =
               upper(trim(coalesce(b.effective_work_mode, '')))
          then 0
          when upper(trim(coalesce(p."Machine or Manual", ''))) = 'BOTH'
          then 1
          else 2
        end
      limit 1
    ) pm on true
  )

  select
    j."LayerID",
    j."Block",
    j."Application",
    j."Flat",
    j."LAYERName",
    j."ID",
    j."Related Backends",
    j."Projection Order",
    j."Billable Layer Order",
    j."Billable",

    j.effective_work_mode as "Selected Work Mode",
    j.matched_productivity_mode as "Matched Productivity Mode",

    j."Projection Total Area",
    j."Projection Done Area",
    j."Remaining Area",
    j."Work Done Pct",

    round(j.ideal_sqft_hr, 2) as "Ideal Sqft/Hr/Labour",

    round(
      case
        when j.ideal_sqft_hr > 0
        then j."Remaining Area" / j.ideal_sqft_hr
        else 0
      end,
      2
    ) as "Labour Hours Required",

    round(
      case
        when j.ideal_sqft_hr > 0
        then (j."Remaining Area" / j.ideal_sqft_hr) / 8
        else 0
      end,
      2
    ) as "Painter Required",

    coalesce(p_daily_painters, 0) as "Daily Painters Input",

    round(
      case
        when coalesce(p_daily_painters, 0) > 0 and j.ideal_sqft_hr > 0
        then ((j."Remaining Area" / j.ideal_sqft_hr) / 8) / p_daily_painters
        else 0
      end,
      2
    ) as "Days Required",

    j."Material Name",
    j."Material Required",
    j."Material Cost"

  from joined j;
$$;


ALTER FUNCTION "public"."get_projection_layers_calc"("p_daily_painters" numeric, "p_work_mode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."zos_to_numeric"("value" "text") RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  with cleaned as (
    select nullif(
      regexp_replace(coalesce(value, ''), '[^0-9\.\-]', '', 'g'),
      ''
    ) as v
  )
  select
    case
      when v ~ '^-?[0-9]+(\.[0-9]+)?$'
      then v::numeric
      else 0
    end
  from cleaned;
$_$;


ALTER FUNCTION "public"."zos_to_numeric"("value" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "indr"."billing_tracker_indr" (
    "id" "text" NOT NULL,
    "Application" "text",
    "Flat" "text",
    "Surface Type" "text",
    "Layer Name" "text",
    "Billed" boolean,
    "Billing Number" "text",
    "Billing Date" "date",
    "Rate" numeric(12,2),
    "Billing Area" numeric(14,2),
    "Status" "text",
    "Batch no." integer,
    "WorkDonePct" numeric(7,2),
    "Is Complete" boolean,
    "Can Billed" boolean,
    "Batch" "text"
);


ALTER TABLE "indr"."billing_tracker_indr" OWNER TO "postgres";


CREATE OR REPLACE VIEW "indr"."already_billed" AS
 SELECT "id",
    "Application",
    "Flat",
    "Surface Type",
    "Layer Name",
    "Billed",
    "Billing Number",
    "Billing Date",
    "Rate",
    "Billing Area",
    "Status",
    "Batch no.",
    "WorkDonePct",
    "Is Complete",
    "Can Billed",
    "Batch"
   FROM "indr"."billing_tracker_indr"
  WHERE ((COALESCE("Billed", false) = true) OR ("upper"(TRIM(BOTH FROM COALESCE("Status", ''::"text"))) = 'APPROVED'::"text") OR (NULLIF(TRIM(BOTH FROM COALESCE("Batch", ''::"text")), ''::"text") IS NOT NULL) OR ("Batch no." IS NOT NULL));


ALTER VIEW "indr"."already_billed" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "indr"."billing_batch_data" (
    "Flat" "text" NOT NULL,
    "1st Fine Putty Ceiling" "text",
    "1st Fine Putty Wall" "text",
    "2nd Fine Putty Ceiling" "text",
    "2nd Fine Putty Wall" "text",
    "1st Coat Primer Ceiling" "text",
    "1st Coat Primer Wall" "text",
    "1st Coat Paint Ceiling" "text",
    "1st Coat Paint Wall" "text",
    "2nd Coat Paint Ceiling" "text",
    "2nd Coat Paint Wall" "text"
);


ALTER TABLE "indr"."billing_batch_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "indr"."flat_area" (
    "Flat" "text" NOT NULL,
    "Ceiling Area" numeric DEFAULT 0,
    "Wall Area" numeric DEFAULT 0
);


ALTER TABLE "indr"."flat_area" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "indr"."invoice_table" (
    "Sl No" numeric NOT NULL,
    "Description of the work" "text" NOT NULL,
    "Layer Name" "text" NOT NULL,
    "Surface" "text" NOT NULL,
    "Unit" "text" DEFAULT 'Sq m'::"text" NOT NULL,
    "Rate" numeric DEFAULT 0 NOT NULL,
    "Quantity Previous" numeric DEFAULT 0,
    "Quantity Current" numeric DEFAULT 0,
    "Quantity Cumulative" numeric DEFAULT 0,
    "Amount Previous" numeric DEFAULT 0,
    "Amount Current" numeric DEFAULT 0,
    "Amount Cumulative" numeric DEFAULT 0
);


ALTER TABLE "indr"."invoice_table" OWNER TO "postgres";


CREATE OR REPLACE VIEW "indr"."latest_billing" AS
 WITH "max_batch" AS (
         SELECT "max"("indr"."get_tracker_batch_no"("billing_tracker_indr"."Batch no.", "billing_tracker_indr"."Batch")) AS "latest_batch_no"
           FROM "indr"."billing_tracker_indr"
          WHERE ("indr"."get_tracker_batch_no"("billing_tracker_indr"."Batch no.", "billing_tracker_indr"."Batch") IS NOT NULL)
        )
 SELECT "t"."id",
    "t"."Application",
    "t"."Flat",
    "t"."Surface Type",
    "t"."Layer Name",
    "t"."Billed",
    "t"."Billing Number",
    "t"."Billing Date",
    "t"."Rate",
    "t"."Billing Area",
    "t"."Status",
    "t"."Batch no.",
    "t"."WorkDonePct",
    "t"."Is Complete",
    "t"."Can Billed",
    "t"."Batch"
   FROM ("indr"."billing_tracker_indr" "t"
     CROSS JOIN "max_batch" "mb")
  WHERE ("indr"."get_tracker_batch_no"("t"."Batch no.", "t"."Batch") = "mb"."latest_batch_no");


ALTER VIEW "indr"."latest_billing" OWNER TO "postgres";


CREATE OR REPLACE VIEW "indr"."pending_billing" AS
 SELECT "id",
    "Application",
    "Flat",
    "Surface Type",
    "Layer Name",
    "Billed",
    "Billing Number",
    "Billing Date",
    "Rate",
    "Billing Area",
    "Status",
    "Batch no.",
    "WorkDonePct",
    "Is Complete",
    "Can Billed",
    "Batch"
   FROM "indr"."billing_tracker_indr"
  WHERE ((COALESCE("Billed", false) = false) AND (COALESCE("WorkDonePct", (0)::numeric) >= (1)::numeric) AND ("upper"(TRIM(BOTH FROM COALESCE("Status", ''::"text"))) = 'NA'::"text"));


ALTER VIEW "indr"."pending_billing" OWNER TO "postgres";


CREATE OR REPLACE VIEW "indr"."sent_for_approval" AS
 SELECT "id",
    "Application",
    "Flat",
    "Surface Type",
    "Layer Name",
    "Billed",
    "Billing Number",
    "Billing Date",
    "Rate",
    "Billing Area",
    "Status",
    "Batch no.",
    "WorkDonePct",
    "Is Complete",
    "Can Billed",
    "Batch"
   FROM "indr"."billing_tracker_indr"
  WHERE ((COALESCE("Billed", false) = false) AND ("upper"(TRIM(BOTH FROM COALESCE("Status", ''::"text"))) = 'SENT'::"text"));


ALTER VIEW "indr"."sent_for_approval" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_users" (
    "UserID" bigint NOT NULL,
    "Username" "text" NOT NULL,
    "PasswordHash" "text" NOT NULL,
    "Role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "IsActive" boolean DEFAULT true NOT NULL,
    "CreatedAt" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_users" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."app_users_UserID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."app_users_UserID_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."app_users_UserID_seq" OWNED BY "public"."app_users"."UserID";



CREATE TABLE IF NOT EXISTS "public"."application aph(1)" (
    "ApplicationID" "text" NOT NULL,
    "Application" "text",
    "FlatStatus" "text",
    "BlockID" "text",
    "Related Flats" "text"
);


ALTER TABLE "public"."application aph(1)" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backend aph" (
    "ID" "text",
    "Block" "text",
    "Application" "text",
    "Flat" "text",
    "Work Layer" "text",
    "Date" "date",
    "WALLName" "text",
    "Area" "text",
    "Painter Name" "text",
    "Machine or Manual" "text",
    "Working Hours" numeric,
    "Work Status" "text",
    "Site" "text",
    "Material Name" "text",
    "Material Used (L/KG)" numeric,
    "Remark" "text",
    "LayerID" "text",
    "user" "text",
    "BackendRowID" bigint NOT NULL
);


ALTER TABLE "public"."backend aph" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."backend aph_BackendRowID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."backend aph_BackendRowID_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."backend aph_BackendRowID_seq" OWNED BY "public"."backend aph"."BackendRowID";



CREATE TABLE IF NOT EXISTS "public"."block" (
    "block id" "text" NOT NULL,
    "block_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."block" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."flat aph(1)" (
    "FlatID" "text" NOT NULL,
    "ApplicationID" "text",
    "FlatName" "text",
    "Projection Total Area" "text"
);


ALTER TABLE "public"."flat aph(1)" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."layer aph(1)" (
    "LayerID" "text" NOT NULL,
    "LAYERName" "text",
    "Block" "text",
    "Application" "text",
    "Flat" "text",
    "ID" "text",
    "Related Backends" "text",
    "Projection Order" integer,
    "Projection Billable?" "text",
    "Projection Total Area" "text",
    "Projection Done Area" "text",
    "Remaining Area" "text",
    "Productivity Sqft Per Hour" "text",
    "Projection Work Mode" "text",
    "Labour Hours Required" "text",
    "Painter Count Required" "text",
    "Days Required" "text",
    "Layer Material Key" "text",
    "Projection Material Name" "text",
    "Projection Material Coverage" integer,
    "Projection Material Rate" "text",
    "Material Required" "text",
    "Material Cost" "text"
);


ALTER TABLE "public"."layer aph(1)" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."material projection" (
    "Application" "text",
    "Work Layer" "text",
    "Material Name" "text",
    "Coverage" integer,
    "Rate" numeric,
    "Material Key" "text",
    "MaterialProjectionID" bigint NOT NULL
);


ALTER TABLE "public"."material projection" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."material projection_MaterialProjectionID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."material projection_MaterialProjectionID_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."material projection_MaterialProjectionID_seq" OWNED BY "public"."material projection"."MaterialProjectionID";



CREATE TABLE IF NOT EXISTS "public"."order aph(2)" (
    "Work Layer" "text",
    "Order" integer,
    "Application" "text",
    "Billable" boolean,
    "OrderID" bigint NOT NULL
);


ALTER TABLE "public"."order aph(2)" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."order aph(2)_OrderID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."order aph(2)_OrderID_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."order aph(2)_OrderID_seq" OWNED BY "public"."order aph(2)"."OrderID";



CREATE TABLE IF NOT EXISTS "public"."productivity aph(1)" (
    "Work Layer" "text",
    "Application" "text",
    "Machine or Manual" "text",
    "Ideal Sqft/Hr/Labour" "text",
    "ProductivityID" bigint NOT NULL
);


ALTER TABLE "public"."productivity aph(1)" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."productivity aph(1)_ProductivityID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."productivity aph(1)_ProductivityID_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."productivity aph(1)_ProductivityID_seq" OWNED BY "public"."productivity aph(1)"."ProductivityID";



CREATE TABLE IF NOT EXISTS "public"."surface aph" (
    "Block" "text" NOT NULL,
    "Application" "text",
    "Base" "text" NOT NULL,
    "Wall" "text",
    "Untitled Column 1" "text",
    "Untitled Column 2" "text",
    "Untitled Column 3" "text",
    "Untitled Column 4" "text",
    "Application Area" "text",
    "Ceiling/Walls Number" "text",
    "Total Area (SFT)" "text",
    "SurfaceID" bigint NOT NULL
);


ALTER TABLE "public"."surface aph" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."surface aph_SurfaceID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."surface aph_SurfaceID_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."surface aph_SurfaceID_seq" OWNED BY "public"."surface aph"."SurfaceID";



CREATE OR REPLACE VIEW "public"."v_projection_layers_billable_base" AS
 WITH "order_master" AS (
         SELECT DISTINCT ON (("upper"(TRIM(BOTH FROM COALESCE("order aph(2)"."Application", ''::"text")))), ("upper"(TRIM(BOTH FROM COALESCE("order aph(2)"."Work Layer", ''::"text"))))) "order aph(2)"."Application",
            "order aph(2)"."Work Layer",
            "order aph(2)"."Order",
            "order aph(2)"."Billable"
           FROM "public"."order aph(2)"
          ORDER BY ("upper"(TRIM(BOTH FROM COALESCE("order aph(2)"."Application", ''::"text")))), ("upper"(TRIM(BOTH FROM COALESCE("order aph(2)"."Work Layer", ''::"text")))), "order aph(2)"."Order"
        ), "layer_base" AS (
         SELECT "l"."LayerID",
            "l"."Block",
            "l"."Application",
            "l"."Flat",
            "l"."LAYERName",
            "l"."ID",
            "l"."Related Backends",
            "l"."Projection Order",
            "l"."Projection Work Mode",
            "om"."Order" AS "Billable Layer Order",
            "om"."Billable",
            "public"."zos_to_numeric"("l"."Projection Total Area") AS "total_area",
            "public"."zos_to_numeric"("l"."Projection Done Area") AS "done_area",
            "mp"."Material Name" AS "material_name",
            "public"."zos_to_numeric"(("mp"."Coverage")::"text") AS "material_coverage",
            "public"."zos_to_numeric"(("mp"."Rate")::"text") AS "material_rate"
           FROM (("public"."layer aph(1)" "l"
             JOIN "order_master" "om" ON ((("upper"(TRIM(BOTH FROM COALESCE("om"."Application", ''::"text"))) = "upper"(TRIM(BOTH FROM COALESCE("l"."Application", ''::"text")))) AND ("upper"(TRIM(BOTH FROM COALESCE("om"."Work Layer", ''::"text"))) = "upper"(TRIM(BOTH FROM COALESCE("l"."LAYERName", ''::"text")))))))
             LEFT JOIN "public"."material projection" "mp" ON ((("upper"(TRIM(BOTH FROM COALESCE("mp"."Application", ''::"text"))) = "upper"(TRIM(BOTH FROM COALESCE("l"."Application", ''::"text")))) AND ("upper"(TRIM(BOTH FROM COALESCE("mp"."Work Layer", ''::"text"))) = "upper"(TRIM(BOTH FROM COALESCE("l"."LAYERName", ''::"text")))))))
          WHERE ("lower"(TRIM(BOTH FROM ("om"."Billable")::"text")) = ANY (ARRAY['true'::"text", 'yes'::"text", '1'::"text", 'billable'::"text"]))
        ), "calculated" AS (
         SELECT "lb"."LayerID",
            "lb"."Block",
            "lb"."Application",
            "lb"."Flat",
            "lb"."LAYERName",
            "lb"."ID",
            "lb"."Related Backends",
            "lb"."Projection Order",
            "lb"."Projection Work Mode",
            "lb"."Billable Layer Order",
            "lb"."Billable",
            "lb"."total_area",
            "lb"."done_area",
            "lb"."material_name",
            "lb"."material_coverage",
            "lb"."material_rate",
            GREATEST(("lb"."total_area" - "lb"."done_area"), (0)::numeric) AS "remaining_area",
                CASE
                    WHEN ("lb"."total_area" > (0)::numeric) THEN (("lb"."done_area" / "lb"."total_area") * (100)::numeric)
                    ELSE (0)::numeric
                END AS "work_done_pct"
           FROM "layer_base" "lb"
        )
 SELECT "LayerID",
    "Block",
    "Application",
    "Flat",
    "LAYERName",
    "ID",
    "Related Backends",
    "Projection Order",
    "Billable Layer Order",
    "Billable",
    "Projection Work Mode",
    "round"("total_area", 2) AS "Projection Total Area",
    "round"("done_area", 2) AS "Projection Done Area",
    "round"("remaining_area", 2) AS "Remaining Area",
    "round"("work_done_pct", 2) AS "Work Done Pct",
    "material_name" AS "Material Name",
    "round"(
        CASE
            WHEN ("material_coverage" > (0)::numeric) THEN ("remaining_area" / "material_coverage")
            ELSE (0)::numeric
        END, 2) AS "Material Required",
    "round"(
        CASE
            WHEN ("material_coverage" > (0)::numeric) THEN (("remaining_area" / "material_coverage") * "material_rate")
            ELSE (0)::numeric
        END, 2) AS "Material Cost"
   FROM "calculated" "c";


ALTER VIEW "public"."v_projection_layers_billable_base" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_flat_completion_calc" AS
 WITH "flat_summary" AS (
         SELECT "v"."Flat" AS "FlatID",
            "string_agg"(DISTINCT "v"."Application", ', '::"text" ORDER BY "v"."Application") AS "Application",
            "count"(*) AS "Billable Layer Count",
            "count"(*) FILTER (WHERE (("v"."Remaining Area" <= (0)::numeric) OR ("v"."Work Done Pct" >= (100)::numeric))) AS "Completed Billable Layer Count",
            "round"("sum"("v"."Projection Total Area"), 2) AS "Billable Total Area",
            "round"("sum"("v"."Projection Done Area"), 2) AS "Billable Done Area",
            "round"("sum"("v"."Remaining Area"), 2) AS "Billable Remaining Area",
            "round"(
                CASE
                    WHEN ("sum"("v"."Projection Total Area") > (0)::numeric) THEN (("sum"("v"."Projection Done Area") / "sum"("v"."Projection Total Area")) * (100)::numeric)
                    ELSE (0)::numeric
                END, 2) AS "Flat Completion Pct"
           FROM "public"."v_projection_layers_billable_base" "v"
          GROUP BY "v"."Flat"
        )
 SELECT "f"."FlatID",
    "f"."ApplicationID",
    "fs"."Application",
    "f"."FlatName" AS "Flat",
    (COALESCE("fs"."Billable Layer Count", (0)::bigint))::integer AS "Billable Layer Count",
    (COALESCE("fs"."Completed Billable Layer Count", (0)::bigint))::integer AS "Completed Billable Layer Count",
    COALESCE("fs"."Billable Total Area", (0)::numeric) AS "Billable Total Area",
    COALESCE("fs"."Billable Done Area", (0)::numeric) AS "Billable Done Area",
    COALESCE("fs"."Billable Remaining Area", (0)::numeric) AS "Billable Remaining Area",
    COALESCE("fs"."Flat Completion Pct", (0)::numeric) AS "Flat Completion Pct",
    "public"."zos_to_numeric"("f"."Projection Total Area") AS "Flat Master Projection Total Area"
   FROM ("public"."flat aph(1)" "f"
     LEFT JOIN "flat_summary" "fs" ON (("upper"(TRIM(BOTH FROM COALESCE("fs"."FlatID", ''::"text"))) = "upper"(TRIM(BOTH FROM COALESCE("f"."FlatID", ''::"text"))))));


ALTER VIEW "public"."v_flat_completion_calc" OWNER TO "postgres";


ALTER TABLE ONLY "public"."app_users" ALTER COLUMN "UserID" SET DEFAULT "nextval"('"public"."app_users_UserID_seq"'::"regclass");



ALTER TABLE ONLY "public"."backend aph" ALTER COLUMN "BackendRowID" SET DEFAULT "nextval"('"public"."backend aph_BackendRowID_seq"'::"regclass");



ALTER TABLE ONLY "public"."material projection" ALTER COLUMN "MaterialProjectionID" SET DEFAULT "nextval"('"public"."material projection_MaterialProjectionID_seq"'::"regclass");



ALTER TABLE ONLY "public"."order aph(2)" ALTER COLUMN "OrderID" SET DEFAULT "nextval"('"public"."order aph(2)_OrderID_seq"'::"regclass");



ALTER TABLE ONLY "public"."productivity aph(1)" ALTER COLUMN "ProductivityID" SET DEFAULT "nextval"('"public"."productivity aph(1)_ProductivityID_seq"'::"regclass");



ALTER TABLE ONLY "public"."surface aph" ALTER COLUMN "SurfaceID" SET DEFAULT "nextval"('"public"."surface aph_SurfaceID_seq"'::"regclass");



ALTER TABLE ONLY "indr"."billing_batch_data"
    ADD CONSTRAINT "billing_batch_data_pkey" PRIMARY KEY ("Flat");



ALTER TABLE ONLY "indr"."billing_tracker_indr"
    ADD CONSTRAINT "billing_tracker_indr_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "indr"."flat_area"
    ADD CONSTRAINT "flat_area_pkey" PRIMARY KEY ("Flat");



ALTER TABLE ONLY "indr"."invoice_table"
    ADD CONSTRAINT "invoice_table_layer_surface_unique" UNIQUE ("Layer Name", "Surface");



ALTER TABLE ONLY "indr"."invoice_table"
    ADD CONSTRAINT "invoice_table_pkey" PRIMARY KEY ("Sl No");



ALTER TABLE ONLY "public"."app_users"
    ADD CONSTRAINT "app_users_Username_key" UNIQUE ("Username");



ALTER TABLE ONLY "public"."app_users"
    ADD CONSTRAINT "app_users_pkey" PRIMARY KEY ("UserID");



ALTER TABLE ONLY "public"."application aph(1)"
    ADD CONSTRAINT "application_aph_1_pk" PRIMARY KEY ("ApplicationID");



ALTER TABLE ONLY "public"."backend aph"
    ADD CONSTRAINT "backend_aph_pk" PRIMARY KEY ("BackendRowID");



ALTER TABLE ONLY "public"."block"
    ADD CONSTRAINT "block_pkey" PRIMARY KEY ("block_name");



ALTER TABLE ONLY "public"."flat aph(1)"
    ADD CONSTRAINT "flat_aph_1_pk" PRIMARY KEY ("FlatID");



ALTER TABLE ONLY "public"."layer aph(1)"
    ADD CONSTRAINT "layer aph(1)_pkey" PRIMARY KEY ("LayerID");



ALTER TABLE ONLY "public"."material projection"
    ADD CONSTRAINT "material projection_pkey" PRIMARY KEY ("MaterialProjectionID");



ALTER TABLE ONLY "public"."order aph(2)"
    ADD CONSTRAINT "order aph(2)_pkey" PRIMARY KEY ("OrderID");



ALTER TABLE ONLY "public"."productivity aph(1)"
    ADD CONSTRAINT "productivity aph(1)_pkey" PRIMARY KEY ("ProductivityID");



ALTER TABLE ONLY "public"."surface aph"
    ADD CONSTRAINT "surface aph_pkey" PRIMARY KEY ("SurfaceID");



CREATE INDEX "idx_billing_tracker_indr_batch" ON "indr"."billing_tracker_indr" USING "btree" ("Batch");



CREATE INDEX "idx_billing_tracker_indr_batch_no" ON "indr"."billing_tracker_indr" USING "btree" ("Batch no.");



CREATE INDEX "idx_billing_tracker_indr_billed_complete" ON "indr"."billing_tracker_indr" USING "btree" ("Billed", "Is Complete", "Can Billed");



CREATE INDEX "idx_billing_tracker_indr_flat_layer_surface" ON "indr"."billing_tracker_indr" USING "btree" ("Flat", "Layer Name", "Surface Type");



CREATE INDEX "idx_billing_tracker_indr_status" ON "indr"."billing_tracker_indr" USING "btree" ("Status");



CREATE INDEX "idx_flat_aph_flat_application" ON "public"."flat aph(1)" USING "btree" ("upper"(TRIM(BOTH FROM COALESCE("FlatName", ''::"text"))), "ApplicationID");



CREATE INDEX "idx_layer_aph_app_layer_flat" ON "public"."layer aph(1)" USING "btree" ("upper"(TRIM(BOTH FROM COALESCE("Application", ''::"text"))), "upper"(TRIM(BOTH FROM COALESCE("LAYERName", ''::"text"))), "upper"(TRIM(BOTH FROM COALESCE("Flat", ''::"text"))));



CREATE INDEX "idx_order_aph_app_layer_billable" ON "public"."order aph(2)" USING "btree" ("upper"(TRIM(BOTH FROM COALESCE("Application", ''::"text"))), "upper"(TRIM(BOTH FROM COALESCE("Work Layer", ''::"text"))), "Billable");



CREATE INDEX "idx_productivity_aph_app_layer_mode" ON "public"."productivity aph(1)" USING "btree" ("upper"(TRIM(BOTH FROM COALESCE("Application", ''::"text"))), "upper"(TRIM(BOTH FROM COALESCE("Work Layer", ''::"text"))), "upper"(TRIM(BOTH FROM COALESCE("Machine or Manual", ''::"text"))));



CREATE OR REPLACE TRIGGER "trg_refresh_billing_batch_data_on_flat_area" AFTER INSERT OR DELETE OR UPDATE ON "indr"."flat_area" FOR EACH STATEMENT EXECUTE FUNCTION "indr"."refresh_billing_batch_data_trigger"();



CREATE OR REPLACE TRIGGER "trg_refresh_billing_batch_data_on_tracker" AFTER INSERT OR DELETE OR UPDATE ON "indr"."billing_tracker_indr" FOR EACH STATEMENT EXECUTE FUNCTION "indr"."refresh_billing_batch_data_trigger"();



ALTER TABLE "indr"."flat_area" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "indr"."invoice_table" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."application aph(1)" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."backend aph" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."block" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."flat aph(1)" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."layer aph(1)" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."material projection" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order aph(2)" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."productivity aph(1)" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."surface aph" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "indr" TO "anon";
GRANT USAGE ON SCHEMA "indr" TO "authenticated";
GRANT USAGE ON SCHEMA "indr" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "indr"."batch_label_to_no"("batch_label" "text") TO "anon";
GRANT ALL ON FUNCTION "indr"."batch_label_to_no"("batch_label" "text") TO "authenticated";
GRANT ALL ON FUNCTION "indr"."batch_label_to_no"("batch_label" "text") TO "service_role";



GRANT ALL ON FUNCTION "indr"."get_invoice_table"("p_batch_no" integer) TO "anon";
GRANT ALL ON FUNCTION "indr"."get_invoice_table"("p_batch_no" integer) TO "authenticated";
GRANT ALL ON FUNCTION "indr"."get_invoice_table"("p_batch_no" integer) TO "service_role";



GRANT ALL ON FUNCTION "indr"."get_tracker_batch_no"("batch_no" integer, "batch_text" "text") TO "anon";
GRANT ALL ON FUNCTION "indr"."get_tracker_batch_no"("batch_no" integer, "batch_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "indr"."get_tracker_batch_no"("batch_no" integer, "batch_text" "text") TO "service_role";



GRANT ALL ON FUNCTION "indr"."refresh_billing_batch_data_core"() TO "anon";
GRANT ALL ON FUNCTION "indr"."refresh_billing_batch_data_core"() TO "authenticated";
GRANT ALL ON FUNCTION "indr"."refresh_billing_batch_data_core"() TO "service_role";



GRANT ALL ON FUNCTION "indr"."refresh_billing_batch_data_trigger"() TO "anon";
GRANT ALL ON FUNCTION "indr"."refresh_billing_batch_data_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "indr"."refresh_billing_batch_data_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "indr"."to_numeric_safe"("value" "text") TO "anon";
GRANT ALL ON FUNCTION "indr"."to_numeric_safe"("value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "indr"."to_numeric_safe"("value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_projection_layers_calc"("p_daily_painters" numeric, "p_work_mode" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_projection_layers_calc"("p_daily_painters" numeric, "p_work_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_projection_layers_calc"("p_daily_painters" numeric, "p_work_mode" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."zos_to_numeric"("value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."zos_to_numeric"("value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."zos_to_numeric"("value" "text") TO "service_role";



GRANT ALL ON TABLE "indr"."billing_tracker_indr" TO "anon";
GRANT ALL ON TABLE "indr"."billing_tracker_indr" TO "authenticated";
GRANT ALL ON TABLE "indr"."billing_tracker_indr" TO "service_role";



GRANT ALL ON TABLE "indr"."already_billed" TO "anon";
GRANT ALL ON TABLE "indr"."already_billed" TO "authenticated";
GRANT ALL ON TABLE "indr"."already_billed" TO "service_role";



GRANT ALL ON TABLE "indr"."billing_batch_data" TO "anon";
GRANT ALL ON TABLE "indr"."billing_batch_data" TO "authenticated";
GRANT ALL ON TABLE "indr"."billing_batch_data" TO "service_role";



GRANT ALL ON TABLE "indr"."flat_area" TO "anon";
GRANT ALL ON TABLE "indr"."flat_area" TO "authenticated";
GRANT ALL ON TABLE "indr"."flat_area" TO "service_role";



GRANT ALL ON TABLE "indr"."invoice_table" TO "anon";
GRANT ALL ON TABLE "indr"."invoice_table" TO "authenticated";
GRANT ALL ON TABLE "indr"."invoice_table" TO "service_role";



GRANT ALL ON TABLE "indr"."latest_billing" TO "anon";
GRANT ALL ON TABLE "indr"."latest_billing" TO "authenticated";
GRANT ALL ON TABLE "indr"."latest_billing" TO "service_role";



GRANT ALL ON TABLE "indr"."pending_billing" TO "anon";
GRANT ALL ON TABLE "indr"."pending_billing" TO "authenticated";
GRANT ALL ON TABLE "indr"."pending_billing" TO "service_role";



GRANT ALL ON TABLE "indr"."sent_for_approval" TO "anon";
GRANT ALL ON TABLE "indr"."sent_for_approval" TO "authenticated";
GRANT ALL ON TABLE "indr"."sent_for_approval" TO "service_role";



GRANT ALL ON TABLE "public"."app_users" TO "anon";
GRANT ALL ON TABLE "public"."app_users" TO "authenticated";
GRANT ALL ON TABLE "public"."app_users" TO "service_role";



GRANT ALL ON SEQUENCE "public"."app_users_UserID_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."app_users_UserID_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."app_users_UserID_seq" TO "service_role";



GRANT ALL ON TABLE "public"."application aph(1)" TO "anon";
GRANT ALL ON TABLE "public"."application aph(1)" TO "authenticated";
GRANT ALL ON TABLE "public"."application aph(1)" TO "service_role";



GRANT ALL ON TABLE "public"."backend aph" TO "anon";
GRANT ALL ON TABLE "public"."backend aph" TO "authenticated";
GRANT ALL ON TABLE "public"."backend aph" TO "service_role";



GRANT ALL ON SEQUENCE "public"."backend aph_BackendRowID_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."backend aph_BackendRowID_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."backend aph_BackendRowID_seq" TO "service_role";



GRANT ALL ON TABLE "public"."block" TO "anon";
GRANT ALL ON TABLE "public"."block" TO "authenticated";
GRANT ALL ON TABLE "public"."block" TO "service_role";



GRANT ALL ON TABLE "public"."flat aph(1)" TO "anon";
GRANT ALL ON TABLE "public"."flat aph(1)" TO "authenticated";
GRANT ALL ON TABLE "public"."flat aph(1)" TO "service_role";



GRANT ALL ON TABLE "public"."layer aph(1)" TO "anon";
GRANT ALL ON TABLE "public"."layer aph(1)" TO "authenticated";
GRANT ALL ON TABLE "public"."layer aph(1)" TO "service_role";



GRANT ALL ON TABLE "public"."material projection" TO "anon";
GRANT ALL ON TABLE "public"."material projection" TO "authenticated";
GRANT ALL ON TABLE "public"."material projection" TO "service_role";



GRANT ALL ON SEQUENCE "public"."material projection_MaterialProjectionID_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."material projection_MaterialProjectionID_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."material projection_MaterialProjectionID_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order aph(2)" TO "anon";
GRANT ALL ON TABLE "public"."order aph(2)" TO "authenticated";
GRANT ALL ON TABLE "public"."order aph(2)" TO "service_role";



GRANT ALL ON SEQUENCE "public"."order aph(2)_OrderID_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order aph(2)_OrderID_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order aph(2)_OrderID_seq" TO "service_role";



GRANT ALL ON TABLE "public"."productivity aph(1)" TO "anon";
GRANT ALL ON TABLE "public"."productivity aph(1)" TO "authenticated";
GRANT ALL ON TABLE "public"."productivity aph(1)" TO "service_role";



GRANT ALL ON SEQUENCE "public"."productivity aph(1)_ProductivityID_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."productivity aph(1)_ProductivityID_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."productivity aph(1)_ProductivityID_seq" TO "service_role";



GRANT ALL ON TABLE "public"."surface aph" TO "anon";
GRANT ALL ON TABLE "public"."surface aph" TO "authenticated";
GRANT ALL ON TABLE "public"."surface aph" TO "service_role";



GRANT ALL ON SEQUENCE "public"."surface aph_SurfaceID_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."surface aph_SurfaceID_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."surface aph_SurfaceID_seq" TO "service_role";



GRANT ALL ON TABLE "public"."v_projection_layers_billable_base" TO "anon";
GRANT ALL ON TABLE "public"."v_projection_layers_billable_base" TO "authenticated";
GRANT ALL ON TABLE "public"."v_projection_layers_billable_base" TO "service_role";



GRANT ALL ON TABLE "public"."v_flat_completion_calc" TO "anon";
GRANT ALL ON TABLE "public"."v_flat_completion_calc" TO "authenticated";
GRANT ALL ON TABLE "public"."v_flat_completion_calc" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "indr" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "indr" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "indr" GRANT ALL ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "indr" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "indr" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "indr" GRANT ALL ON TABLES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







