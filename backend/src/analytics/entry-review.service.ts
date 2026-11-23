import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateEntryReviewDto } from './dto/update-entry-review.dto';

type JsonObject = Record<string, unknown>;

type EntryReviewQuery = {
  filters?: JsonObject;
  reviewFilters?: JsonObject;
  limit?: number;
  offset?: number;
};

const BILLABLE_LAYER_NAMES = [
  '1st Coat Putty',
  '2nd Coat Putty',
  '1st Coat Primer',
  '2nd Coat Primer',
  '1st Coat Paint',
  '2nd Coat Paint',
];

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return Number(value);

  if (
    typeof value === 'object' &&
    value !== null &&
    'toNumber' in value &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  ) {
    const parsed = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateText(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function dateTimeText(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function valueList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .filter((item) => item.toLowerCase() !== 'all');
  }

  const text = String(value || '').trim();
  if (!text || text.toLowerCase() === 'all') return [];

  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.toLowerCase() !== 'all');
}

function valueText(value: unknown): string {
  const text = String(value || '').trim();
  return text.toLowerCase() === 'all' ? '' : text;
}

function normalizedIn(column: Prisma.Sql, values: string[]): Prisma.Sql | null {
  if (!values.length) return null;
  return Prisma.sql`indr.norm_text(${column}) in (${Prisma.join(
    values.map((value) => Prisma.sql`indr.norm_text(${value})`),
  )})`;
}

function billableSql(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`indr.norm_text(${column}) in (${Prisma.join(
    BILLABLE_LAYER_NAMES.map(
      (value) => Prisma.sql`indr.norm_text(${value})`,
    ),
  )})`;
}

@Injectable()
export class EntryReviewService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(
    projectId: string,
    filters: JsonObject,
    reviewFilters: JsonObject,
  ): Prisma.Sql {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`b.project_id = ${projectId}`,
    ];

    const block = valueList(filters.block);
    const application = valueList(filters.application);
    const flat = valueList(filters.flat);
    const workLayer = valueList(filters.workLayer);

    const blockCondition = normalizedIn(Prisma.sql`b.block`, block);
    const appCondition = normalizedIn(Prisma.sql`b.application`, application);
    const flatCondition = normalizedIn(Prisma.sql`b.flat`, flat);
    const layerCondition = normalizedIn(Prisma.sql`b.work_layer`, workLayer);

    if (blockCondition) conditions.push(blockCondition);
    if (appCondition) conditions.push(appCondition);
    if (flatCondition) conditions.push(flatCondition);
    if (layerCondition) conditions.push(layerCondition);

    const from = valueText(filters.from);
    const to = valueText(filters.to);
    if (from) conditions.push(Prisma.sql`b.work_date >= ${from}::date`);
    if (to) conditions.push(Prisma.sql`b.work_date <= ${to}::date`);

    const billing = valueText(filters.billing).toLowerCase();
    if (billing === 'billable') {
      conditions.push(billableSql(Prisma.sql`b.work_layer`));
    } else if (billing === 'non_billable') {
      conditions.push(Prisma.sql`not (${billableSql(Prisma.sql`b.work_layer`)})`);
    }

    const search = valueText(filters.search);
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(Prisma.sql`(
        coalesce(b.block, '') ilike ${pattern}
        or coalesce(b.application, '') ilike ${pattern}
        or coalesce(b.flat, '') ilike ${pattern}
        or coalesce(b.work_layer, '') ilike ${pattern}
        or coalesce(b.painter_names, '') ilike ${pattern}
        or coalesce(b.material_name, '') ilike ${pattern}
        or coalesce(b.remark, '') ilike ${pattern}
      )`);
    }

    const dates = valueList(reviewFilters.dates);
    if (dates.length) {
      conditions.push(
        Prisma.sql`b.work_date in (${Prisma.join(
          dates.map((date) => Prisma.sql`${date}::date`),
        )})`,
      );
    }

    const reviewLayers = valueList(reviewFilters.workLayers);
    const reviewLayerCondition = normalizedIn(
      Prisma.sql`b.work_layer`,
      reviewLayers,
    );
    if (reviewLayerCondition) conditions.push(reviewLayerCondition);

    const workStatuses = valueList(reviewFilters.workStatuses);
    const workStatusCondition = normalizedIn(
      Prisma.sql`b.work_status`,
      workStatuses,
    );
    if (workStatusCondition) conditions.push(workStatusCondition);

    const painters = valueList(reviewFilters.painters);
    if (painters.length) {
      conditions.push(Prisma.sql`exists (
        select 1
        from regexp_split_to_table(
          coalesce(b.painter_names, ''),
          '\\s*(,|;|\\||/|&)\\s*|\\s+[Aa][Nn][Dd]\\s+'
        ) as selected_painter(name)
        where indr.norm_text(selected_painter.name) in (${Prisma.join(
          painters.map((painter) => Prisma.sql`indr.norm_text(${painter})`),
        )})
      )`);
    }

    const reviewStatus = valueText(reviewFilters.reviewStatus).toLowerCase();
    if (reviewStatus === 'open' || reviewStatus === 'pending') {
      conditions.push(Prisma.sql`(
        r.backend_id is null
        or (
          r.review_status = 'open'
          and nullif(btrim(coalesce(r.review_comment, '')), '') is null
        )
      )`);
    } else if (reviewStatus === 'approved') {
      conditions.push(Prisma.sql`r.review_status = 'approved'`);
    } else if (reviewStatus === 'rejected') {
      conditions.push(Prisma.sql`r.review_status = 'rejected'`);
    } else if (reviewStatus === 'commented' || reviewStatus === 'noted') {
      conditions.push(
        Prisma.sql`nullif(btrim(coalesce(r.review_comment, '')), '') is not null`,
      );
    }

    return Prisma.join(conditions, ' and ');
  }

  private mapRow(row: any) {
    const labourDays = toNumber(row.labour_days);
    const area = toNumber(row.area);
    const materialUsed = toNumber(row.material_used_l_kg);
    const targetProductivity = toNumber(row.target_productivity);
    const targetCoverage = toNumber(row.target_coverage);
    const productivity = labourDays > 0 ? area / labourDays : 0;
    const coverage = materialUsed > 0 ? area / materialUsed : 0;

    return {
      id: String(row.id || ''),
      projectId: String(row.project_id || ''),
      block: String(row.block || ''),
      application: String(row.application || ''),
      flat: String(row.flat || ''),
      workLayer: String(row.work_layer || ''),
      workDate: dateText(row.work_date),
      wallNames: String(row.wall_names || ''),
      area,
      painterNames: String(row.painter_names || ''),
      painterCount: toNumber(row.painter_count),
      machineOrManual: String(row.machine_or_manual || ''),
      workingHours: toNumber(row.working_hours),
      workStatus: String(row.work_status || ''),
      materialName: String(row.material_name || ''),
      materialUsed,
      remark: String(row.remark || ''),
      layerId: String(row.layer_id || ''),
      labourDays,
      productivity,
      coverage,
      targetProductivity,
      targetCoverage,
      productivityDeviationPct:
        targetProductivity > 0
          ? ((productivity - targetProductivity) * 100) / targetProductivity
          : null,
      coverageDeviationPct:
        targetCoverage > 0
          ? ((coverage - targetCoverage) * 100) / targetCoverage
          : null,
      labourCost: toNumber(row.labour_cost),
      materialCost: toNumber(row.material_cost),
      layerOrder: toNumber(row.layer_order || 999),
      reviewStatus: String(row.review_status || 'open'),
      reviewComment: row.review_comment ? String(row.review_comment) : '',
      reviewedBy: row.reviewed_by ? String(row.reviewed_by) : '',
      reviewedAt: dateTimeText(row.reviewed_at),
    };
  }

  async getEntryReview(projectId: string, query: EntryReviewQuery) {
    const filters = query.filters || {};
    const reviewFilters = query.reviewFilters || {};
    const limit = Math.min(Math.max(Number(query.limit) || 400, 1), 400);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const whereSql = this.buildWhere(projectId, filters, reviewFilters);
    const scopeReviewFilters = { ...reviewFilters };
    delete scopeReviewFilters.reviewStatus;
    const scopeWhereSql = this.buildWhere(
      projectId,
      filters,
      scopeReviewFilters,
    );
    const optionsWhereSql = this.buildWhere(projectId, filters, {});

    const [rows, rowCountRows, summaryRows, optionRows, painterRows] = await Promise.all([
      this.prisma.$queryRaw<any[]>`
        with filtered as (
          select
            b.*,
            r.review_status,
            r.review_comment,
            r.reviewed_by,
            r.reviewed_at,
            case
              when nullif(btrim(coalesce(b.painter_names, '')), '') is null then 0
              else cardinality(
                regexp_split_to_array(
                  btrim(b.painter_names),
                  '\\s*(,|;|\\||/|&)\\s*|\\s+[Aa][Nn][Dd]\\s+'
                )
              )
            end::numeric as painter_count
          from indr.backend b
          left join indr.backend_entry_review r
            on r.backend_id = b.id
          where ${whereSql}
        )
        select
          f.*,
          coalesce(costing.productivity, 0)::numeric as target_productivity,
          coalesce(costing.material_coverage, 0)::numeric as target_coverage,
          coalesce(costing.per_labour_cost, 0)::numeric as per_labour_cost,
          coalesce(costing.material_rate_per_unit, 0)::numeric as material_rate_per_unit,
          case
            when f.painter_count > 0 and coalesce(f.working_hours, 0) > 0
            then (f.painter_count * f.working_hours) / 8.0
            else 0::numeric
          end as labour_days,
          case
            when f.painter_count > 0 and coalesce(f.working_hours, 0) > 0
            then ((f.painter_count * f.working_hours) / 8.0)
                 * coalesce(costing.per_labour_cost, 0)
            else 0::numeric
          end as labour_cost,
          coalesce(f.material_used_l_kg, 0)
            * coalesce(costing.material_rate_per_unit, 0) as material_cost,
          coalesce(layer_sequence.layer_order, 999)::numeric as layer_order
        from filtered f
        left join lateral (
          select
            p.productivity,
            p.material_coverage,
            p.per_labour_cost,
            p.material_rate_per_unit
          from indr.project_flat_layer_costing p
          where p.project_id = f.project_id
            and indr.norm_text(p.application) = indr.norm_text(f.application)
            and indr.norm_text(p.flat_id) = indr.norm_text(f.flat)
            and indr.norm_text(p.layer_name) = indr.norm_text(f.work_layer)
          order by p.id
          limit 1
        ) costing on true
        left join lateral (
          select min(coalesce(l."order", 999))::numeric as layer_order
          from indr.layer l
          where l.project_id = f.project_id
            and indr.norm_text(l.application) = indr.norm_text(f.application)
            and (
              indr.norm_text(coalesce(l.flat_id, '')) = indr.norm_text(f.flat)
              or indr.norm_text(coalesce(l.flat, '')) = indr.norm_text(f.flat)
            )
            and indr.norm_text(l.layer_name) = indr.norm_text(f.work_layer)
        ) layer_sequence on true
        order by
          f.work_date desc nulls last,
          f.application,
          f.flat,
          coalesce(layer_sequence.layer_order, 999),
          f.work_layer,
          f.id
        limit ${limit}
        offset ${offset}
      `,

      this.prisma.$queryRaw<any[]>`
        select count(*)::numeric as total
        from indr.backend b
        left join indr.backend_entry_review r
          on r.backend_id = b.id
        where ${whereSql}
      `,

      this.prisma.$queryRaw<any[]>`
        with scoped as (
          select b.*, r.backend_id as review_id, r.review_status, r.review_comment
          from indr.backend b
          left join indr.backend_entry_review r
            on r.backend_id = b.id
          where ${scopeWhereSql}
        ),
        painters as (
          select distinct btrim(p.name) as painter
          from scoped s
          cross join lateral regexp_split_to_table(
            coalesce(s.painter_names, ''),
            '\\s*(,|;|\\||/|&)\\s*|\\s+[Aa][Nn][Dd]\\s+'
          ) as p(name)
          where nullif(btrim(p.name), '') is not null
        )
        select
          count(*)::numeric as entries_in_view,
          count(*) filter (
            where review_id is not null
              and (
                review_status in ('approved', 'rejected')
                or nullif(btrim(coalesce(review_comment, '')), '') is not null
              )
          )::numeric as checked,
          count(*) filter (where review_status = 'approved')::numeric as approved,
          count(*) filter (where review_status = 'rejected')::numeric as rejected,
          count(*) filter (
            where nullif(btrim(coalesce(review_comment, '')), '') is not null
          )::numeric as with_comment,
          (select count(*) from painters)::numeric as painters,
          coalesce(sum(working_hours), 0)::numeric as working_hours,
          count(distinct work_date) filter (where work_date is not null)::numeric as days_covered
        from scoped
      `,

      this.prisma.$queryRaw<any[]>`
        with scoped as (
          select b.*, r.review_status, r.review_comment
          from indr.backend b
          left join indr.backend_entry_review r
            on r.backend_id = b.id
          where ${optionsWhereSql}
        ),
        painter_values as (
          select distinct btrim(p.name) as painter
          from scoped s
          cross join lateral regexp_split_to_table(
            coalesce(s.painter_names, ''),
            '\\s*(,|;|\\||/|&)\\s*|\\s+[Aa][Nn][Dd]\\s+'
          ) as p(name)
          where nullif(btrim(p.name), '') is not null
        )
        select
          coalesce(
            array_agg(distinct work_date order by work_date desc)
              filter (where work_date is not null),
            array[]::date[]
          ) as dates,
          coalesce(
            array_agg(distinct work_layer order by work_layer)
              filter (where nullif(btrim(coalesce(work_layer, '')), '') is not null),
            array[]::text[]
          ) as work_layers,
          coalesce(
            array_agg(distinct work_status order by work_status)
              filter (where nullif(btrim(coalesce(work_status, '')), '') is not null),
            array[]::text[]
          ) as work_statuses,
          (select coalesce(array_agg(painter order by painter), array[]::text[]) from painter_values) as painters
        from scoped
      `,

      this.prisma.$queryRaw<any[]>`
        with scoped as (
          select
            b.*,
            case
              when nullif(btrim(coalesce(b.painter_names, '')), '') is null then 0
              else cardinality(
                regexp_split_to_array(
                  btrim(b.painter_names),
                  '\\s*(,|;|\\||/|&)\\s*|\\s+[Aa][Nn][Dd]\\s+'
                )
              )
            end::numeric as painter_count
          from indr.backend b
          left join indr.backend_entry_review r
            on r.backend_id = b.id
          where ${scopeWhereSql}
        ),
        expanded as (
          select
            s.*,
            btrim(p.name) as painter,
            case when s.painter_count > 0 then coalesce(s.area, 0) / s.painter_count else 0 end as painter_area,
            case when coalesce(s.working_hours, 0) > 0 then s.working_hours / 8.0 else 0 end as painter_labour_days
          from scoped s
          cross join lateral regexp_split_to_table(
            coalesce(s.painter_names, ''),
            '\\s*(,|;|\\||/|&)\\s*|\\s+[Aa][Nn][Dd]\\s+'
          ) as p(name)
          where nullif(btrim(p.name), '') is not null
        )
        select
          e.painter,
          count(*)::numeric as entries,
          count(distinct e.work_date) filter (where e.work_date is not null)::numeric as days_on_site,
          coalesce(sum(e.working_hours), 0)::numeric as working_hours,
          coalesce(sum(e.painter_labour_days), 0)::numeric as labour_days,
          coalesce(sum(e.painter_area), 0)::numeric as area,
          count(distinct e.work_layer)::numeric as layers,
          count(distinct e.flat)::numeric as flats,
          min(e.work_date) as first_date,
          max(e.work_date) as last_date,
          coalesce(
            array_agg(distinct e.work_layer order by e.work_layer)
              filter (where nullif(btrim(coalesce(e.work_layer, '')), '') is not null),
            array[]::text[]
          ) as layer_list,
          coalesce(
            array_agg(distinct e.application order by e.application)
              filter (where nullif(btrim(coalesce(e.application, '')), '') is not null),
            array[]::text[]
          ) as applications
        from expanded e
        group by e.painter
        order by area desc, e.painter
      `,
    ]);

    const rowTotal = toNumber(rowCountRows[0]?.total);
    const summary = summaryRows[0] || {};
    const options = optionRows[0] || {};

    return {
      summary: {
        entriesInView: toNumber(summary.entries_in_view),
        checked: toNumber(summary.checked),
        approved: toNumber(summary.approved),
        rejected: toNumber(summary.rejected),
        withComment: toNumber(summary.with_comment),
        painters: toNumber(summary.painters),
        workingHours: toNumber(summary.working_hours),
        daysCovered: toNumber(summary.days_covered),
      },
      options: {
        dates: (options.dates || []).map(dateText).filter(Boolean),
        painters: (options.painters || []).map((value: unknown) => String(value)),
        workLayers: (options.work_layers || []).map((value: unknown) => String(value)),
        workStatuses: (options.work_statuses || []).map((value: unknown) => String(value)),
        reviewStatuses: ['open', 'approved', 'rejected', 'commented'],
      },
      rows: rows.map((row) => this.mapRow(row)),
      painterReport: painterRows.map((row) => {
        const labourDays = toNumber(row.labour_days);
        const area = toNumber(row.area);
        const workingHours = toNumber(row.working_hours);
        return {
          painter: String(row.painter || ''),
          entries: toNumber(row.entries),
          daysOnSite: toNumber(row.days_on_site),
          workingHours,
          labourDays,
          area,
          productivity: labourDays > 0 ? area / labourDays : 0,
          sqftPerHour: workingHours > 0 ? area / workingHours : 0,
          layers: toNumber(row.layers),
          flats: toNumber(row.flats),
          firstDate: dateText(row.first_date),
          lastDate: dateText(row.last_date),
          layerList: (row.layer_list || []).map((value: unknown) => String(value)),
          applications: (row.applications || []).map((value: unknown) => String(value)),
        };
      }),
      pagination: {
        limit,
        offset,
        total: rowTotal,
        hasMore: offset + rows.length < rowTotal,
      },
    };
  }

  async updateEntryReview(
    projectId: string,
    backendId: string,
    reviewer: string,
    dto: UpdateEntryReviewDto,
  ) {
    const status = dto.status === undefined ? undefined : String(dto.status);
    if (
      status !== undefined &&
      !['open', 'approved', 'rejected'].includes(status)
    ) {
      throw new BadRequestException('Unsupported review status');
    }

    const backendRows = await this.prisma.$queryRaw<any[]>`
      select id, project_id
      from indr.backend
      where id = ${backendId}
        and project_id = ${projectId}
      limit 1
    `;

    if (!backendRows.length) {
      throw new NotFoundException('Backend entry not found for this project');
    }

    const currentRows = await this.prisma.$queryRaw<any[]>`
      select review_status, review_comment
      from indr.backend_entry_review
      where backend_id = ${backendId}
      limit 1
    `;

    const current = currentRows[0] || {};
    const nextStatus = status ?? String(current.review_status || 'open');
    const nextComment =
      dto.comment === undefined
        ? String(current.review_comment || '')
        : String(dto.comment || '').trim();

    // Match the reference HTML: no decision + no comment means no review row.
    if (nextStatus === 'open' && !nextComment) {
      await this.prisma.$executeRaw`
        delete from indr.backend_entry_review
        where backend_id = ${backendId}
      `;

      return {
        backendId,
        reviewStatus: 'open',
        reviewComment: '',
        reviewedBy: '',
        reviewedAt: null,
      };
    }

    const reviewedBy = String(reviewer || '').trim() || 'admin';

    const updatedRows = await this.prisma.$queryRaw<any[]>`
      insert into indr.backend_entry_review (
        backend_id,
        project_id,
        review_status,
        review_comment,
        reviewed_by,
        reviewed_at
      ) values (
        ${backendId},
        ${projectId},
        ${nextStatus},
        ${nextComment || null},
        ${reviewedBy},
        now()
      )
      on conflict (backend_id)
      do update set
        review_status = excluded.review_status,
        review_comment = excluded.review_comment,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at
      returning
        backend_id,
        review_status,
        review_comment,
        reviewed_by,
        reviewed_at
    `;

    const row = updatedRows[0] || {};
    return {
      backendId: String(row.backend_id || backendId),
      reviewStatus: String(row.review_status || nextStatus),
      reviewComment: String(row.review_comment || ''),
      reviewedBy: String(row.reviewed_by || reviewedBy),
      reviewedAt: dateTimeText(row.reviewed_at),
    };
  }

  async clearEntryReview(projectId: string, backendId: string) {
    const deleted = await this.prisma.$executeRaw`
      delete from indr.backend_entry_review r
      using indr.backend b
      where r.backend_id = b.id
        and r.backend_id = ${backendId}
        and b.project_id = ${projectId}
    `;

    if (!deleted) {
      const backendRows = await this.prisma.$queryRaw<any[]>`
        select id
        from indr.backend
        where id = ${backendId}
          and project_id = ${projectId}
        limit 1
      `;
      if (!backendRows.length) {
        throw new NotFoundException('Backend entry not found for this project');
      }
    }

    return {
      backendId,
      reviewStatus: 'open',
      reviewComment: '',
      reviewedBy: '',
      reviewedAt: null,
    };
  }
}
