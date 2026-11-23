import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type ExecutiveFilters = {
  application?: string;
  flat?: string;
  workLayer?: string;
  block?: string;
  from?: string;
  to?: string;
  profitability?: string;
  billing?: string;
  search?: string;
};

type TargetLabourMetrics = {
  bookedDays: number;
  targetDays: number;
  vsTarget: number;
  targetUsePct: number;
};

function clean(value?: string) {
  const text = String(value || '').trim();
  if (!text || text.toLowerCase() === 'all') return '';
  return text;
}

function cleanList(value?: string) {
  return String(value || '')
    .split(',')
    .map((item) => clean(item))
    .filter(Boolean)
    .filter((item) => item.toLowerCase() !== 'all');
}

function normalizedIn(columnSql: Prisma.Sql, values: string[]) {
  if (!values.length) return null;

  return Prisma.sql`${columnSql} in (${Prisma.join(
    values.map((value) => Prisma.sql`indr.norm_text(${value})`),
  )})`;
}

function lowerIn(columnSql: Prisma.Sql, values: string[]) {
  if (!values.length) return null;

  return Prisma.sql`${columnSql} in (${Prisma.join(
    values.map((value) => Prisma.sql`${value.toLowerCase()}`),
  )})`;
}


const ANALYTICS_BILLABLE_LAYER_NAMES = [
  '1st Coat Putty',
  '2nd Coat Putty',
  '1st Coat Primer',
  '2nd Coat Primer',
  '1st Coat Paint',
  '2nd Coat Paint',
];

function analyticsBillableSql(columnSql: Prisma.Sql) {
  return Prisma.sql`${columnSql} in (${Prisma.join(
    ANALYTICS_BILLABLE_LAYER_NAMES.map(
      (value) => Prisma.sql`indr.norm_text(${value})`,
    ),
  )})`;
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return 0;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

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

type DateTimelineEntry = TargetLabourMetrics & {
  flatId: string;
  workLayer: string;
  materialNames: string;
  layerOrder: number;
  entries: number;
  isBillable: boolean;
  area: number;
  labourDays: number;
  labour: number;
  material: number;
  materialUsed: number;
  revenue: number;
  profit: number;
  productivity: number;
};

type DateTimelineApplication = TargetLabourMetrics & {
  application: string;
  flats: number;
  layers: number;
  area: number;
  labourDays: number;
  labour: number;
  material: number;
  materialUsed: number;
  revenue: number;
  profit: number;
  productivity: number;
  entries: DateTimelineEntry[];
};

type DateTimelineDay = TargetLabourMetrics & {
  workDate: string;
  flats: number;
  layers: number;
  area: number;
  labourDays: number;
  labour: number;
  material: number;
  materialUsed: number;
  revenue: number;
  profit: number;
  productivity: number;
  applications: DateTimelineApplication[];
};

function dateKey(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function buildTargetMetrics(bookedDays: number, targetDays: number): TargetLabourMetrics {
  return {
    bookedDays,
    targetDays,
    vsTarget: bookedDays - targetDays,
    targetUsePct: targetDays > 0 ? (bookedDays * 100) / targetDays : 0,
  };
}

function buildDateTimeline(rows: any[]): DateTimelineDay[] {
  const dayMap = new Map<
    string,
    DateTimelineDay & { flatKeys: Set<string>; layerKeys: Set<string> }
  >();
  const appMaps = new Map<
    string,
    Map<
      string,
      DateTimelineApplication & { flatKeys: Set<string>; layerKeys: Set<string> }
    >
  >();

  rows.forEach((item) => {
    const workDate = dateKey(item.work_date);
    if (!workDate) return;

    const application = String(item.application || 'Unassigned');
    const flatId = String(item.flat_id || '');
    const workLayer = String(item.work_layer || '');
    const layerOrder = toNumber(item.layer_order || 999);

    const bookedDays = toNumber(item.booked_days || item.labour_days);
    const targetDays = toNumber(item.target_days);

    const entry: DateTimelineEntry = {
      flatId,
      workLayer,
      materialNames: String(item.material_names || ''),
      layerOrder,
      entries: toNumber(item.entries || 1),
      isBillable: Boolean(item.is_billable),
      area: toNumber(item.area),
      labourDays: toNumber(item.labour_days),
      bookedDays,
      targetDays,
      vsTarget: toNumber(item.vs_target || bookedDays - targetDays),
      targetUsePct: toNumber(
        item.target_use_pct || (targetDays > 0 ? (bookedDays * 100) / targetDays : 0),
      ),
      labour: toNumber(item.labour),
      material: toNumber(item.material),
      materialUsed: toNumber(item.material_used),
      revenue: toNumber(item.revenue),
      profit: toNumber(item.profit),
      productivity: toNumber(item.productivity),
    };

    if (!dayMap.has(workDate)) {
      dayMap.set(workDate, {
        workDate,
        flats: 0,
        layers: 0,
        area: 0,
        labourDays: 0,
        bookedDays: 0,
        targetDays: 0,
        vsTarget: 0,
        targetUsePct: 0,
        labour: 0,
        material: 0,
        materialUsed: 0,
        revenue: 0,
        profit: 0,
        productivity: 0,
        applications: [],
        flatKeys: new Set<string>(),
        layerKeys: new Set<string>(),
      });
      appMaps.set(workDate, new Map());
    }

    const day = dayMap.get(workDate)!;
    day.area += entry.area;
    day.labourDays += entry.labourDays;
    day.bookedDays += entry.bookedDays;
    day.targetDays += entry.targetDays;
    day.labour += entry.labour;
    day.material += entry.material;
    day.materialUsed += entry.materialUsed;
    day.revenue += entry.revenue;
    day.profit += entry.profit;
    if (flatId) day.flatKeys.add(flatId);
    if (workLayer) day.layerKeys.add(workLayer);

    const dayApps = appMaps.get(workDate)!;
    if (!dayApps.has(application)) {
      dayApps.set(application, {
        application,
        flats: 0,
        layers: 0,
        area: 0,
        labourDays: 0,
        bookedDays: 0,
        targetDays: 0,
        vsTarget: 0,
        targetUsePct: 0,
        labour: 0,
        material: 0,
        materialUsed: 0,
        revenue: 0,
        profit: 0,
        productivity: 0,
        entries: [],
        flatKeys: new Set<string>(),
        layerKeys: new Set<string>(),
      });
    }

    const app = dayApps.get(application)!;
    app.area += entry.area;
    app.labourDays += entry.labourDays;
    app.bookedDays += entry.bookedDays;
    app.targetDays += entry.targetDays;
    app.labour += entry.labour;
    app.material += entry.material;
    app.materialUsed += entry.materialUsed;
    app.revenue += entry.revenue;
    app.profit += entry.profit;
    if (flatId) app.flatKeys.add(flatId);
    if (workLayer) app.layerKeys.add(workLayer);
    app.entries.push(entry);
  });

  return Array.from(dayMap.values())
    .map((day) => {
      const apps = Array.from(appMaps.get(day.workDate)?.values() || []).map((app) => ({
        application: app.application,
        flats: app.flatKeys.size,
        layers: app.layerKeys.size,
        area: app.area,
        labourDays: app.labourDays,
        bookedDays: app.bookedDays,
        targetDays: app.targetDays,
        vsTarget: app.bookedDays - app.targetDays,
        targetUsePct: app.targetDays > 0 ? (app.bookedDays * 100) / app.targetDays : 0,
        labour: app.labour,
        material: app.material,
        materialUsed: app.materialUsed,
        revenue: app.revenue,
        profit: app.profit,
        productivity: app.labourDays > 0 ? app.area / app.labourDays : 0,
        entries: app.entries.sort((a, b) => {
          const flatCompare = a.flatId.localeCompare(b.flatId, undefined, {
            numeric: true,
            sensitivity: 'base',
          });
          if (flatCompare) return flatCompare;
          const orderCompare = Number(a.layerOrder || 999) - Number(b.layerOrder || 999);
          if (orderCompare) return orderCompare;
          return a.workLayer.localeCompare(b.workLayer, undefined, {
            numeric: true,
            sensitivity: 'base',
          });
        }),
      }));

      apps.sort((a, b) =>
        a.application.localeCompare(b.application, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      );

      return {
        workDate: day.workDate,
        flats: day.flatKeys.size,
        layers: day.layerKeys.size,
        area: day.area,
        labourDays: day.labourDays,
        bookedDays: day.bookedDays,
        targetDays: day.targetDays,
        vsTarget: day.bookedDays - day.targetDays,
        targetUsePct: day.targetDays > 0 ? (day.bookedDays * 100) / day.targetDays : 0,
        labour: day.labour,
        material: day.material,
        materialUsed: day.materialUsed,
        revenue: day.revenue,
        profit: day.profit,
        productivity: day.labourDays > 0 ? day.area / day.labourDays : 0,
        applications: apps,
      };
    })
    .sort((a, b) => b.workDate.localeCompare(a.workDate));
}

function costGroupedRows(rows: any[]) {
  return rows.map((item) => {
    const bookedDays = toNumber(item.booked_days || item.labour_days);
    const targetDays = toNumber(item.target_days);

    return {
      workLayer: String(item.work_layer || ''),
      entries: toNumber(item.entries),
      flats: toNumber(item.flats),
      area: toNumber(item.area),
      labourDays: toNumber(item.labour_days),
      bookedDays,
      targetDays,
      vsTarget: toNumber(item.vs_target || bookedDays - targetDays),
      targetUsePct: toNumber(
        item.target_use_pct || (targetDays > 0 ? (bookedDays * 100) / targetDays : 0),
      ),
      labour: toNumber(item.labour),
      material: toNumber(item.material),
      revenue: toNumber(item.revenue),
      profit: toNumber(item.profit),
      totalCost: toNumber(item.total_cost),
      percentOfRevenue: toNumber(item.percent_of_revenue),
    };
  });
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async refresh(projectId?: string) {
    // Keep the existing source refresh exactly as-is, then refresh the
    // read-optimized Analytics caches. Heavy joins/views are therefore paid
    // once on explicit refresh instead of on every dashboard request.
    await this.prisma.$executeRawUnsafe(`
      do $$
      begin
        perform public.refresh_project_analytics();
      end $$;
    `);

    await this.prisma.$executeRawUnsafe(
      'refresh materialized view analytics_cache.mv_work_performance',
    );
    await this.prisma.$executeRawUnsafe(
      'refresh materialized view analytics_cache.mv_budget_flat_layer',
    );

    return {
      success: true,
      message: projectId
        ? `Analytics source data refreshed successfully for ${projectId}`
        : 'Analytics source data refreshed successfully',
      refreshedAt: new Date().toISOString(),
    };
  }

  async getOptions(projectId: string) {
    // Compact structural graph:
    // block↔application, application↔flat and application↔layer.
    // Do NOT send one browser relation row for every flat×layer combination.
    const [optionGraph] = await this.prisma.$queryRaw<any[]>`
      with relation_source as materialized (
        select
          trim(coalesce(p.block, ''))::text as block,
          trim(coalesce(p.application, ''))::text as application,
          trim(coalesce(p.flat_id, ''))::text as flat_id,
          trim(coalesce(p.layer_name, ''))::text as work_layer
        from indr.project_flat_layer_costing p
        where p.project_id = ${projectId}

        union all

        select
          trim(coalesce(w.block, ''))::text as block,
          trim(coalesce(w.application, ''))::text as application,
          trim(coalesce(w.flat_id, ''))::text as flat_id,
          trim(coalesce(w.work_layer, ''))::text as work_layer
        from analytics_cache.mv_work_performance w
        where w.project_id = ${projectId}
      ),
      block_application as (
        select distinct block, application
        from relation_source
        where application <> ''
      ),
      application_flat as (
        select distinct block, application, flat_id
        from relation_source
        where application <> '' and flat_id <> ''
      ),
      application_layer as (
        select distinct block, application, work_layer
        from relation_source
        where application <> '' and work_layer <> ''
      )
      select
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'block', x.block,
                'application', x.application
              )
              order by x.block, x.application
            )
            from block_application x
          ),
          '[]'::jsonb
        ) as block_applications,

        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'block', x.block,
                'application', x.application,
                'flat', x.flat_id
              )
              order by x.block, x.application, x.flat_id
            )
            from application_flat x
          ),
          '[]'::jsonb
        ) as application_flats,

        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'block', x.block,
                'application', x.application,
                'workLayer', x.work_layer
              )
              order by x.block, x.application, x.work_layer
            )
            from application_layer x
          ),
          '[]'::jsonb
        ) as application_layers
    `;

    const blockApplications = Array.isArray(optionGraph?.block_applications)
      ? optionGraph.block_applications
      : [];
    const applicationFlats = Array.isArray(optionGraph?.application_flats)
      ? optionGraph.application_flats
      : [];
    const applicationLayers = Array.isArray(optionGraph?.application_layers)
      ? optionGraph.application_layers
      : [];

    const unique = (values: string[]) =>
      Array.from(
        new Map(
          values
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .map((value) => [value.toLowerCase(), value] as const),
        ).values(),
      ).sort((a, b) =>
        a.localeCompare(b, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      );

    return {
      applications: unique([
        ...blockApplications.map((row: any) => String(row.application || '')),
        ...applicationFlats.map((row: any) => String(row.application || '')),
      ]),
      blocks: unique([
        ...blockApplications.map((row: any) => String(row.block || '')),
        ...applicationFlats.map((row: any) => String(row.block || '')),
      ]),
      flats: unique(
        applicationFlats.map((row: any) => String(row.flat || '')),
      ),
      workLayers: unique(
        applicationLayers.map((row: any) => String(row.workLayer || '')),
      ),

      // Backward-compatible legacy key.
      filterRelations: [],

      blockApplicationRelations: blockApplications,
      applicationFlatRelations: applicationFlats,
      applicationLayerRelations: applicationLayers,

      profitability: ['all', 'profit', 'loss', 'break_even'],
      billing: ['all', 'billable', 'non_billable'],
    };
  }

  private buildWhere(projectId: string, filters: ExecutiveFilters) {
    const conditions: Prisma.Sql[] = [Prisma.sql`project_id = ${projectId}`];

    const applications = cleanList(filters.application);
    const flats = cleanList(filters.flat);
    const blocks = cleanList(filters.block);
    const workLayers = cleanList(filters.workLayer);
    const from = clean(filters.from);
    const to = clean(filters.to);
    const profitabilityValues = cleanList(filters.profitability).map((item) => item.toLowerCase());
    const billingValues = cleanList(filters.billing).map((item) => item.toLowerCase());
    const search = clean(filters.search);

    const applicationSql = normalizedIn(Prisma.sql`indr.norm_text(application)`, applications);
    if (applicationSql) conditions.push(applicationSql);

    const flatSql = normalizedIn(Prisma.sql`indr.norm_text(flat_id)`, flats);
    if (flatSql) conditions.push(flatSql);

    const blockSql = normalizedIn(Prisma.sql`indr.norm_text(block)`, blocks);
    if (blockSql) conditions.push(blockSql);

    const workLayerSql = normalizedIn(Prisma.sql`indr.norm_text(work_layer)`, workLayers);
    if (workLayerSql) conditions.push(workLayerSql);

    if (from) {
      conditions.push(Prisma.sql`work_date >= ${from}::date`);
    }

    if (to) {
      conditions.push(Prisma.sql`work_date <= ${to}::date`);
    }

    if (profitabilityValues.length && !profitabilityValues.includes('all')) {
      const profitabilityConditions: Prisma.Sql[] = [];

      if (profitabilityValues.includes('profit')) {
        profitabilityConditions.push(Prisma.sql`profit > 0.5`);
      }

      if (profitabilityValues.includes('loss')) {
        profitabilityConditions.push(Prisma.sql`profit < -0.5`);
      }

      if (profitabilityValues.includes('break_even') || profitabilityValues.includes('even')) {
        profitabilityConditions.push(Prisma.sql`abs(profit) <= 0.5`);
      }

      if (profitabilityConditions.length) {
        conditions.push(Prisma.sql`(${Prisma.join(profitabilityConditions, ' or ')})`);
      }
    }

    if (billingValues.length && !billingValues.includes('all')) {
      const billingConditions: Prisma.Sql[] = [];

      if (billingValues.includes('billable')) {
        billingConditions.push(
          analyticsBillableSql(Prisma.sql`indr.norm_text(work_layer)`),
        );
      }

      if (billingValues.includes('non_billable')) {
        billingConditions.push(
          Prisma.sql`not (${analyticsBillableSql(Prisma.sql`indr.norm_text(work_layer)`)})`,
        );
      }

      if (billingConditions.length) {
        conditions.push(Prisma.sql`(${Prisma.join(billingConditions, ' or ')})`);
      }
    }

    if (search) {
      const pattern = `%${search}%`;

      conditions.push(Prisma.sql`
        (
          application ilike ${pattern}
          or flat_id ilike ${pattern}
          or block ilike ${pattern}
          or work_layer ilike ${pattern}
          or material_name ilike ${pattern}
        )
      `);
    }

    return Prisma.join(conditions, ' and ');
  }

  private buildSurfaceWhere(projectId: string, filters: ExecutiveFilters) {
    const conditions: Prisma.Sql[] = [Prisma.sql`s.project_id = ${projectId}`];

    const applications = cleanList(filters.application);
    const flats = cleanList(filters.flat);
    const blocks = cleanList(filters.block);
    const search = clean(filters.search);

    const applicationSql = normalizedIn(Prisma.sql`indr.norm_text(s.application)`, applications);
    if (applicationSql) conditions.push(applicationSql);

    const flatSql = normalizedIn(Prisma.sql`indr.norm_text(s.flat_id)`, flats);
    if (flatSql) conditions.push(flatSql);

    const blockSql = normalizedIn(Prisma.sql`indr.norm_text(s.block)`, blocks);
    if (blockSql) conditions.push(blockSql);

    if (search) {
      const pattern = `%${search}%`;

      conditions.push(Prisma.sql`
        (
          s.application ilike ${pattern}
          or s.flat_id ilike ${pattern}
          or s.block ilike ${pattern}
        )
      `);
    }

    return Prisma.join(conditions, ' and ');
  }


  private buildBudgetWhere(projectId: string, filters: ExecutiveFilters) {
    const conditions: Prisma.Sql[] = [Prisma.sql`project_id = ${projectId}`];

    const applications = cleanList(filters.application);
    const flats = cleanList(filters.flat);
    const blocks = cleanList(filters.block);
    const workLayers = cleanList(filters.workLayer);
    const billingValues = cleanList(filters.billing).map((item) => item.toLowerCase());
    const search = clean(filters.search);

    const applicationSql = normalizedIn(Prisma.sql`indr.norm_text(application)`, applications);
    if (applicationSql) conditions.push(applicationSql);

    const flatSql = normalizedIn(Prisma.sql`indr.norm_text(flat_id)`, flats);
    if (flatSql) conditions.push(flatSql);

    const blockSql = normalizedIn(Prisma.sql`indr.norm_text(block)`, blocks);
    if (blockSql) conditions.push(blockSql);

    const workLayerSql = normalizedIn(Prisma.sql`indr.norm_text(work_layer)`, workLayers);
    if (workLayerSql) conditions.push(workLayerSql);

    if (billingValues.length && !billingValues.includes('all')) {
      const billingConditions: Prisma.Sql[] = [];

      if (billingValues.includes('billable')) {
        billingConditions.push(
          analyticsBillableSql(Prisma.sql`indr.norm_text(work_layer)`),
        );
      }

      if (billingValues.includes('non_billable')) {
        billingConditions.push(
          Prisma.sql`not (${analyticsBillableSql(Prisma.sql`indr.norm_text(work_layer)`)})`,
        );
      }

      if (billingConditions.length) {
        conditions.push(Prisma.sql`(${Prisma.join(billingConditions, ' or ')})`);
      }
    }

    if (search) {
      const pattern = `%${search}%`;

      conditions.push(Prisma.sql`
        (
          application ilike ${pattern}
          or flat_id ilike ${pattern}
          or block ilike ${pattern}
          or work_layer ilike ${pattern}
          or material_names ilike ${pattern}
        )
      `);
    }

    return Prisma.join(conditions, ' and ');
  }

  async getReport(projectId: string, filters: ExecutiveFilters) {
    // Section 02 Report intentionally reads the already-prepared Analytics
    // materialized source and enriches it with the original backend entry.
    // It is loaded only when the Report tab is opened, so this detailed
    // entry-level payload never regresses the fast Executive Summary path.
    const whereSql = this.buildWhere(projectId, filters);

    const rows = await this.prisma.$queryRaw<any[]>`
      with scoped as materialized (
        select *
        from analytics_cache.mv_work_performance
        where ${whereSql}
      )
      select
        s.id,
        s.project_id,
        s.block,
        s.application,
        s.flat_id,
        s.work_layer,
        s.work_date,
        coalesce(s.area, 0)::numeric as area,
        coalesce(s.labour_count, 0)::numeric as labour_days,
        coalesce(s.labour_cost, 0)::numeric as labour_cost,
        coalesce(s.material_cost, 0)::numeric as material_cost,
        coalesce(s.client_value, 0)::numeric as client_value,
        coalesce(s.profit, 0)::numeric as profit,
        coalesce(s.work_status, '')::text as work_status,
        coalesce(s.material_name, b.material_name, '')::text as material_name,
        coalesce(s.material_used_l_kg, b.material_used_l_kg, 0)::numeric as material_used,
        coalesce(s.is_billable, false)::boolean as is_billable,
        coalesce(s.layer_order, 999)::numeric as layer_order,
        coalesce(b.painter_names, '')::text as painter_names,
        coalesce(b.working_hours, 0)::numeric as working_hours,
        coalesce(b.remark, '')::text as remark,
        coalesce(r.review_status, 'open')::text as review_status,
        coalesce(r.review_comment, '')::text as review_comment,
        coalesce(r.reviewed_by, '')::text as reviewed_by,
        r.reviewed_at,
        coalesce(costing.target_labour_days, s.target_days, 0)::numeric as target_days,
        coalesce(costing.productivity, 0)::numeric as target_productivity,
        coalesce(costing.material_coverage, 0)::numeric as target_coverage,
        coalesce(costing.material_rate_per_unit, 0)::numeric as material_rate,
        coalesce(costing.total_area_sft, 0)::numeric as flat_area
      from scoped s
      left join indr.backend b
        on b.project_id = s.project_id
       and b.id = s.id
      left join indr.backend_entry_review r
        on r.backend_id = s.id
      left join lateral (
        select
          p.target_labour_days,
          p.productivity,
          p.material_coverage,
          p.material_rate_per_unit,
          p.total_area_sft
        from indr.project_flat_layer_costing p
        where p.project_id = s.project_id
          and indr.norm_text(p.application) = indr.norm_text(s.application)
          and indr.norm_text(p.flat_id) = indr.norm_text(s.flat_id)
          and indr.norm_text(p.layer_name) = indr.norm_text(s.work_layer)
        order by p.id
        limit 1
      ) costing on true
      order by
        s.work_date desc nulls last,
        s.application,
        s.flat_id,
        coalesce(s.layer_order, 999),
        s.work_layer,
        s.id
    `;

    return {
      recordCount: rows.length,
      rows: rows.map((row) => ({
        id: String(row.id || ''),
        projectId: String(row.project_id || ''),
        block: String(row.block || ''),
        application: String(row.application || ''),
        flatId: String(row.flat_id || ''),
        workLayer: String(row.work_layer || ''),
        workDate: dateKey(row.work_date),
        area: toNumber(row.area),
        labourDays: toNumber(row.labour_days),
        labourCost: toNumber(row.labour_cost),
        materialCost: toNumber(row.material_cost),
        revenue: toNumber(row.client_value),
        profit: toNumber(row.profit),
        workStatus: String(row.work_status || ''),
        materialName: String(row.material_name || ''),
        materialUsed: toNumber(row.material_used),
        isBillable: Boolean(row.is_billable),
        layerOrder: toNumber(row.layer_order || 999),
        painterNames: String(row.painter_names || ''),
        workingHours: toNumber(row.working_hours),
        remark: String(row.remark || ''),
        reviewStatus: String(row.review_status || 'open'),
        reviewComment: String(row.review_comment || ''),
        reviewedBy: String(row.reviewed_by || ''),
        reviewedAt:
          row.reviewed_at instanceof Date
            ? row.reviewed_at.toISOString()
            : row.reviewed_at
              ? String(row.reviewed_at)
              : null,
        targetDays: toNumber(row.target_days),
        targetProductivity: toNumber(row.target_productivity),
        targetCoverage: toNumber(row.target_coverage),
        materialRate: toNumber(row.material_rate),
        flatArea: toNumber(row.flat_area),
      })),
    };
  }

  async getExecutiveSummary(
    projectId: string,
    filters: ExecutiveFilters,
    section = 'all',
  ) {
    const requestedSection = String(section || 'all').trim().toLowerCase();
    const isAllSections = !requestedSection || requestedSection === 'all';

    const needsApplicationSummary =
      isAllSections ||
      requestedSection === 'executive' ||
      requestedSection === 'cost';

    const needsFlatSummary =
      isAllSections ||
      [
        'executive',
        'flats',
        'flat-detail',
        'targets',
        'pl',
        'productivity',
        'cost',
      ].includes(requestedSection);

    const needsDailyTrend =
      isAllSections || requestedSection === 'executive';

    const needsDateTimeline =
      isAllSections ||
      requestedSection === 'timeline' ||
      requestedSection === 'productivity';

    // Trend Analysis is intentionally section-only. Do not add its monthly
    // payload to the legacy `all` response and regress the optimized Analytics path.
    const needsTrend = requestedSection === 'trend';

    // Flat-detail rows are intentionally excluded from Executive Summary and
    // Flat-wise list requests. They are loaded only when a flat is expanded.
    const needsFlatDetail =
      isAllSections ||
      ['flat-detail', 'targets', 'pl', 'productivity', 'cost'].includes(
        requestedSection,
      );

    const needsBudget =
      isAllSections || requestedSection === 'budget';

    const whereSql = this.buildWhere(projectId, filters);
    const surfaceWhereSql = this.buildSurfaceWhere(projectId, filters);
    const budgetWhereSql = this.buildBudgetWhere(projectId, filters);
    const selectedTargetWorkLayers = cleanList(filters.workLayer);
    const targetLayerCondition = selectedTargetWorkLayers.length
      ? Prisma.sql`indr.norm_text(work_layer) in (${Prisma.join(
          selectedTargetWorkLayers.map((value) => Prisma.sql`indr.norm_text(${value})`),
        )})`
      : Prisma.sql`true`;

    const [
      kpiRows,
      applicationSummaryRows,
      flatSummaryRows,
      dailyTrendRows,
      dateTimelineRows,
      trendRows,
      flatDetailRows,
      costStructureRows,
      costDistributionRows,
      costDrillDownRows,
      nonBillableCostRows,
      noAreaCostRows,
      budgetApplicationRows,
      budgetFlatLayerRows,
      budgetTrendRows,
    ] = await Promise.all([
      requestedSection === 'trend'
        ? Promise.resolve([{}] as any[])
        : this.prisma.$queryRaw<any[]>`
        with filtered as (
          select *
          from analytics_cache.mv_work_performance
          where ${whereSql}
        ),

        target_plan as (
          select
            project_id,
            application,
            work_layer,
            max(target_days)::numeric as target_days
          from public.v_project_target_labour_lookup
          where project_id = ${projectId}
            and ${targetLayerCondition}
          group by project_id, application, work_layer
        ),

        filtered_flats as (
          select distinct project_id, application, flat_id
          from filtered
        ),

        target_totals as (
          select
            coalesce(sum(tp.target_days), 0)::numeric as target_days
          from filtered_flats ff
          left join target_plan tp
            on tp.project_id = ff.project_id
           and indr.norm_text(tp.application) = indr.norm_text(ff.application)
        ),

        flat_rollup as (
          select
            project_id,
            application,
            flat_id,
            sum(area)::numeric as area,
            sum(client_value)::numeric as client_value,
            sum(labour_cost)::numeric as labour_cost,
            sum(material_cost)::numeric as material_cost,
            sum(profit)::numeric as profit,
            sum(labour_count)::numeric as labour_count,
            coalesce(sum(booked_days), 0)::numeric as booked_days,
            case
              when sum(labour_count) > 0
              then sum(area) / sum(labour_count)
              else 0::numeric
            end as productivity
          from filtered
          group by
            project_id,
            application,
            flat_id
        ),

        totals as (
          select
            count(*)::numeric as record_count,
            count(distinct application)::numeric as applications,
            count(distinct flat_id)::numeric as flats_worked,

            coalesce(sum(area), 0)::numeric as executed_area,
            coalesce(sum(client_value), 0)::numeric as client_value,
            coalesce(sum(labour_cost), 0)::numeric as labour_cost,
            coalesce(sum(material_cost), 0)::numeric as material_cost,
            coalesce(sum(profit), 0)::numeric as net_profit,
            coalesce(sum(labour_count), 0)::numeric as labour_days,
            coalesce(sum(booked_days), 0)::numeric as booked_days,

            case
              when coalesce(sum(client_value), 0) > 0
              then coalesce(sum(profit), 0) * 100 / sum(client_value)
              else 0::numeric
            end as profit_margin,

            case
              when coalesce(sum(labour_count), 0) > 0
              then coalesce(sum(area), 0) / sum(labour_count)
              else 0::numeric
            end as productivity,

            coalesce(
              sum(labour_cost + material_cost) filter (
                where not (${analyticsBillableSql(Prisma.sql`indr.norm_text(work_layer)`)})
              ),
              0
            )::numeric as non_billable_operational_work,
            count(*) filter (
              where not (${analyticsBillableSql(Prisma.sql`indr.norm_text(work_layer)`)})
            )::numeric as non_billable_entries

          from filtered
        ),

        booked_pairs as (
          select
            f.project_id, f.application, f.flat_id, f.work_layer,
            coalesce(sum(f.booked_days), 0)::numeric as booked_days,
            coalesce(sum(f.labour_cost), 0)::numeric as labour_cost
          from filtered f
          group by f.project_id, f.application, f.flat_id, f.work_layer
        ),

        booked_target_totals as (
          select
            coalesce(sum(case when tp.target_days is not null then bp.booked_days else 0 end), 0)::numeric as actual_booked_targeted_days,
            coalesce(sum(case when tp.target_days is not null then tp.target_days else 0 end), 0)::numeric as target_booked_days,
            coalesce(sum(case when tp.target_days is null then bp.booked_days else 0 end), 0)::numeric as untargeted_days,
            coalesce(sum(case when tp.target_days is not null then bp.labour_cost else 0 end), 0)::numeric as targeted_labour_cost
          from booked_pairs bp
          left join target_plan tp
            on tp.project_id = bp.project_id
           and indr.norm_text(tp.application) = indr.norm_text(bp.application)
           and indr.norm_text(tp.work_layer) = indr.norm_text(bp.work_layer)
        ),

        flat_coverage as (
          select
            ff.application, ff.flat_id,
            count(distinct tp.work_layer)::numeric as total_layers,
            count(distinct bp.work_layer) filter (where bp.work_layer is not null)::numeric as booked_layers
          from filtered_flats ff
          left join target_plan tp
            on tp.project_id = ff.project_id
           and indr.norm_text(tp.application) = indr.norm_text(ff.application)
          left join booked_pairs bp
            on bp.project_id = ff.project_id
           and indr.norm_text(bp.application) = indr.norm_text(ff.application)
           and indr.norm_text(bp.flat_id) = indr.norm_text(ff.flat_id)
           and indr.norm_text(bp.work_layer) = indr.norm_text(tp.work_layer)
          group by ff.application, ff.flat_id
        ),

        flat_flags as (
          select
            count(*) filter (where profit > 0.5)::numeric as flats_in_profit,
            count(*) filter (where profit < -0.5)::numeric as flats_in_loss,

            count(*) filter (
              where productivity > 0
                and productivity < (select productivity * 0.5 from totals)
            )::numeric as flats_below_50_productivity,
            count(*) filter (
              where productivity > 0
                and productivity < (select productivity * 0.6 from totals)
            )::numeric as flats_below_60_productivity

          from flat_rollup
        ),

        open_flat_flags as (
          select count(*) filter (where total_layers > 0 and booked_layers < total_layers)::numeric as flats_with_layers_to_book
          from flat_coverage
        ),

        surface_total as (
          select
            coalesce(sum(s.total_area_ft), 0)::numeric as total_project_area
          from public.v_project_surface_area_base s
          where ${surfaceWhereSql}
        )

        select
          totals.*,
          coalesce(target_totals.target_days, 0)::numeric as target_days,
          (totals.booked_days - coalesce(target_totals.target_days, 0))::numeric as vs_target,
          case
            when coalesce(target_totals.target_days, 0) > 0
            then totals.booked_days * 100 / target_totals.target_days
            else null::numeric
          end as target_use_pct,
          flat_flags.flats_in_profit,
          flat_flags.flats_in_loss,
          flat_flags.flats_below_50_productivity,
          flat_flags.flats_below_60_productivity,
          open_flat_flags.flats_with_layers_to_book,
          booked_target_totals.target_booked_days,
          booked_target_totals.actual_booked_targeted_days,
          booked_target_totals.untargeted_days,
          booked_target_totals.targeted_labour_cost,
          surface_total.total_project_area
        from totals
        cross join target_totals
        cross join booked_target_totals
        cross join flat_flags
        cross join open_flat_flags
        cross join surface_total
      `,

      needsApplicationSummary
        ? this.prisma.$queryRaw<any[]>`
        with filtered as (
          select *
          from analytics_cache.mv_work_performance
          where ${whereSql}
        ),

        app_base as (
          select
            application,
            count(*)::numeric as entries,
            count(distinct flat_id)::numeric as flats,
            coalesce(sum(labour_count), 0)::numeric as labour_days,
            coalesce(sum(booked_days), 0)::numeric as booked_days,
            coalesce(sum(area), 0)::numeric as area,
            coalesce(sum(labour_cost), 0)::numeric as labour,
            coalesce(sum(material_cost), 0)::numeric as material,
            coalesce(sum(client_value), 0)::numeric as revenue,
            coalesce(sum(profit), 0)::numeric as net_profit
          from filtered
          group by application
        ),

        filtered_flats as (
          select distinct project_id, application, flat_id
          from filtered
        ),

        target_plan as (
          select
            project_id,
            application,
            work_layer,
            max(target_days)::numeric as target_days
          from public.v_project_target_labour_lookup
          where project_id = ${projectId}
            and ${targetLayerCondition}
          group by project_id, application, work_layer
        ),

        app_target_per_flat as (
          select
            application,
            coalesce(sum(target_days), 0)::numeric as target_per_flat
          from target_plan
          group by application
        ),

        app_target_full as (
          select
            ff.application,
            coalesce(sum(tp.target_days), 0)::numeric as target_days
          from filtered_flats ff
          left join target_plan tp
            on tp.project_id = ff.project_id
           and indr.norm_text(tp.application) = indr.norm_text(ff.application)
          group by ff.application
        ),

        booked_pairs as (
          select
            project_id,
            application,
            flat_id,
            work_layer,
            coalesce(sum(booked_days), 0)::numeric as booked_days,
            coalesce(sum(labour_cost), 0)::numeric as labour_cost
          from filtered
          group by project_id, application, flat_id, work_layer
        ),

        booked_target as (
          select
            bp.application,
            coalesce(sum(case when tp.target_days is not null then tp.target_days else 0 end), 0)::numeric as target_booked,
            coalesce(sum(case when tp.target_days is not null then bp.booked_days else 0 end), 0)::numeric as actual_booked,
            coalesce(sum(case when tp.target_days is null then bp.booked_days else 0 end), 0)::numeric as untargeted_days,
            count(distinct bp.work_layer) filter (where tp.target_days is null)::numeric as untargeted_layers,
            coalesce(sum(case when tp.target_days is not null then bp.labour_cost else 0 end), 0)::numeric as targeted_labour_cost
          from booked_pairs bp
          left join target_plan tp
            on tp.project_id = bp.project_id
           and indr.norm_text(tp.application) = indr.norm_text(bp.application)
           and indr.norm_text(tp.work_layer) = indr.norm_text(bp.work_layer)
          group by bp.application
        )

        select
          a.application,
          a.entries,
          a.flats,
          a.labour_days,
          a.booked_days,
          coalesce(tf.target_days, 0)::numeric as target_days,
          (a.booked_days - coalesce(tf.target_days, 0))::numeric as vs_target,
          case
            when coalesce(tf.target_days, 0) > 0
            then a.booked_days * 100 / tf.target_days
            else null::numeric
          end as target_use_pct,
          coalesce(tpf.target_per_flat, 0)::numeric as target_per_flat,
          coalesce(bt.target_booked, 0)::numeric as target_booked,
          coalesce(bt.actual_booked, 0)::numeric as actual_booked,
          (coalesce(bt.actual_booked, 0) - coalesce(bt.target_booked, 0))::numeric as booked_vs_target,
          case
            when coalesce(bt.target_booked, 0) > 0
            then coalesce(bt.actual_booked, 0) * 100 / bt.target_booked
            else null::numeric
          end as booked_target_use_pct,
          coalesce(bt.untargeted_days, 0)::numeric as untargeted_days,
          coalesce(bt.untargeted_layers, 0)::numeric as untargeted_layers,
          case
            when coalesce(bt.actual_booked, 0) > 0
            then coalesce(bt.targeted_labour_cost, 0) / bt.actual_booked
            else 0::numeric
          end as targeted_labour_rate,
          case
            when coalesce(bt.actual_booked, 0) > 0
            then (coalesce(bt.actual_booked, 0) - coalesce(bt.target_booked, 0))
                 * (coalesce(bt.targeted_labour_cost, 0) / bt.actual_booked)
            else 0::numeric
          end as labour_value_gap,
          a.area,
          a.labour,
          a.material,
          a.revenue,
          a.net_profit,
          case when a.revenue > 0 then a.net_profit * 100 / a.revenue else 0::numeric end as margin,
          case when a.labour_days > 0 then a.area / a.labour_days else 0::numeric end as productivity,
          case when a.area > 0 then a.net_profit / a.area else 0::numeric end as profit_per_sqft
        from app_base a
        left join app_target_full tf on tf.application = a.application
        left join app_target_per_flat tpf on indr.norm_text(tpf.application) = indr.norm_text(a.application)
        left join booked_target bt on indr.norm_text(bt.application) = indr.norm_text(a.application)
        order by a.application
      `
        : Promise.resolve([] as any[]),

      needsFlatSummary
        ? this.prisma.$queryRaw<any[]>`
        with filtered as (
          select *
          from analytics_cache.mv_work_performance
          where ${whereSql}
        ),

        flat_rollup as (
          select
            project_id,
            application,
            flat_id,
            count(distinct work_layer)::numeric as booked_layers,
            count(*)::numeric as entries,
            coalesce(sum(labour_count), 0)::numeric as labour_days,
            coalesce(sum(booked_days), 0)::numeric as booked_days,
            coalesce(sum(area), 0)::numeric as area,
            coalesce(sum(labour_cost), 0)::numeric as labour,
            coalesce(sum(material_cost), 0)::numeric as material,
            coalesce(sum(client_value), 0)::numeric as revenue,
            coalesce(sum(profit), 0)::numeric as net_profit
          from filtered
          group by project_id, application, flat_id
        ),

        target_plan as (
          select
            project_id,
            application,
            work_layer,
            max(target_days)::numeric as target_days
          from public.v_project_target_labour_lookup
          where project_id = ${projectId}
            and ${targetLayerCondition}
          group by project_id, application, work_layer
        ),

        target_per_app as (
          select application, coalesce(sum(target_days), 0)::numeric as target_per_flat
          from target_plan
          group by application
        ),

        flat_targets as (
          select
            f.application,
            f.flat_id,
            count(distinct tp.work_layer)::numeric as total_layers,
            coalesce(sum(tp.target_days), 0)::numeric as target_days
          from flat_rollup f
          left join target_plan tp
            on tp.project_id = f.project_id
           and indr.norm_text(tp.application) = indr.norm_text(f.application)
          group by f.application, f.flat_id
        ),

        booked_pairs as (
          select
            project_id, application, flat_id, work_layer,
            coalesce(sum(booked_days), 0)::numeric as booked_days,
            coalesce(sum(labour_cost), 0)::numeric as labour_cost
          from filtered
          group by project_id, application, flat_id, work_layer
        ),

        booked_target as (
          select
            bp.application,
            bp.flat_id,
            coalesce(sum(case when tp.target_days is not null then tp.target_days else 0 end), 0)::numeric as target_booked,
            coalesce(sum(case when tp.target_days is not null then bp.booked_days else 0 end), 0)::numeric as actual_booked,
            coalesce(sum(case when tp.target_days is null then bp.booked_days else 0 end), 0)::numeric as untargeted_days,
            count(distinct bp.work_layer) filter (where tp.target_days is null)::numeric as untargeted_layers,
            coalesce(sum(case when tp.target_days is not null then bp.labour_cost else 0 end), 0)::numeric as targeted_labour_cost
          from booked_pairs bp
          left join target_plan tp
            on tp.project_id = bp.project_id
           and indr.norm_text(tp.application) = indr.norm_text(bp.application)
           and indr.norm_text(tp.work_layer) = indr.norm_text(bp.work_layer)
          group by bp.application, bp.flat_id
        )

        select
          f.application,
          f.flat_id,
          f.booked_layers,
          f.entries,
          coalesce(t.total_layers, 0)::numeric as total_layers,
          f.labour_days,
          f.booked_days,
          coalesce(t.target_days, 0)::numeric as target_days,
          (f.booked_days - coalesce(t.target_days, 0))::numeric as vs_target,
          case when coalesce(t.target_days, 0) > 0 then f.booked_days * 100 / t.target_days else null::numeric end as target_use_pct,
          coalesce(tpa.target_per_flat, 0)::numeric as target_per_flat,
          coalesce(bt.target_booked, 0)::numeric as target_booked,
          coalesce(bt.actual_booked, 0)::numeric as actual_booked,
          (coalesce(bt.actual_booked, 0) - coalesce(bt.target_booked, 0))::numeric as booked_vs_target,
          case when coalesce(bt.target_booked, 0) > 0 then coalesce(bt.actual_booked, 0) * 100 / bt.target_booked else null::numeric end as booked_target_use_pct,
          coalesce(bt.untargeted_days, 0)::numeric as untargeted_days,
          coalesce(bt.untargeted_layers, 0)::numeric as untargeted_layers,
          case when coalesce(bt.actual_booked, 0) > 0 then coalesce(bt.targeted_labour_cost, 0) / bt.actual_booked else 0::numeric end as targeted_labour_rate,
          case when coalesce(bt.actual_booked, 0) > 0 then
            (coalesce(bt.actual_booked, 0) - coalesce(bt.target_booked, 0)) * (coalesce(bt.targeted_labour_cost, 0) / bt.actual_booked)
            else 0::numeric end as labour_value_gap,
          f.area,
          f.labour,
          f.material,
          f.revenue,
          f.net_profit,
          case when f.revenue > 0 then f.net_profit * 100 / f.revenue else 0::numeric end as margin,
          case when f.labour_days > 0 then f.area / f.labour_days else 0::numeric end as productivity,
          case when f.area > 0 then f.net_profit / f.area else 0::numeric end as profit_per_sqft
        from flat_rollup f
        left join flat_targets t on t.application = f.application and t.flat_id = f.flat_id
        left join target_per_app tpa on indr.norm_text(tpa.application) = indr.norm_text(f.application)
        left join booked_target bt on indr.norm_text(bt.application) = indr.norm_text(f.application) and indr.norm_text(bt.flat_id) = indr.norm_text(f.flat_id)
        order by f.application, f.flat_id
      `
        : Promise.resolve([] as any[]),

      needsDailyTrend
        ? this.prisma.$queryRaw<any[]>`
        with filtered as (
          select *
          from analytics_cache.mv_work_performance
          where ${whereSql}
        ),

        layer_day as (
          select
            work_date,
            application,
            flat_id,
            work_layer,
            coalesce(sum(profit), 0)::numeric as profit,
            coalesce(sum(labour_count), 0)::numeric as labour_days,
            coalesce(sum(booked_days), 0)::numeric as booked_days,
            coalesce(max(target_days), 0)::numeric as target_days,
            coalesce(sum(client_value), 0)::numeric as revenue,
            coalesce(sum(labour_cost), 0)::numeric as labour,
            coalesce(sum(material_cost), 0)::numeric as material
          from filtered
          where work_date is not null
          group by
            work_date,
            application,
            flat_id,
            work_layer
        )

        select
          work_date,
          coalesce(sum(profit), 0)::numeric as profit,
          coalesce(sum(labour_days), 0)::numeric as labour_days,
          coalesce(sum(booked_days), 0)::numeric as booked_days,
          coalesce(sum(target_days), 0)::numeric as target_days,
          (
            coalesce(sum(booked_days), 0)
            - coalesce(sum(target_days), 0)
          )::numeric as vs_target,
          case
            when coalesce(sum(target_days), 0) > 0
            then coalesce(sum(booked_days), 0) * 100 / sum(target_days)
            else null::numeric
          end as target_use_pct,
          coalesce(sum(revenue), 0)::numeric as revenue,
          coalesce(sum(labour), 0)::numeric as labour,
          coalesce(sum(material), 0)::numeric as material
        from layer_day
        group by work_date
        order by work_date
      `
        : Promise.resolve([] as any[]),

      needsDateTimeline
        ? this.prisma.$queryRaw<any[]>`
        with filtered as (
          select *
          from analytics_cache.mv_work_performance
          where ${whereSql}
        )
        select
          f.work_date,
          f.application,
          f.flat_id,
          f.work_layer,
          coalesce(string_agg(distinct nullif(trim(f.material_name), ''), ', '), '')::text as material_names,
          coalesce(min(l."order"), 999)::numeric as layer_order,
          count(*)::numeric as entries,
          bool_or(f.is_billable)::boolean as is_billable,
          coalesce(sum(f.area), 0)::numeric as area,
          coalesce(sum(f.labour_count), 0)::numeric as labour_days,
          coalesce(sum(f.booked_days), 0)::numeric as booked_days,
          coalesce(max(f.target_days), 0)::numeric as target_days,
          (
            coalesce(sum(f.booked_days), 0)
            - coalesce(max(f.target_days), 0)
          )::numeric as vs_target,
          case
            when coalesce(max(f.target_days), 0) > 0
            then coalesce(sum(f.booked_days), 0) * 100 / max(f.target_days)
            else null::numeric
          end as target_use_pct,
          coalesce(sum(f.labour_cost), 0)::numeric as labour,
          coalesce(sum(f.material_cost), 0)::numeric as material,
          coalesce(
            sum(
              case
                when coalesce(to_jsonb(f)->>'material_used_l_kg', '')
                     ~ '^-?[0-9]+([.][0-9]+)?$'
                then (to_jsonb(f)->>'material_used_l_kg')::numeric
                else 0::numeric
              end
            ),
            0
          )::numeric as material_used,
          coalesce(sum(f.client_value), 0)::numeric as revenue,
          coalesce(sum(f.profit), 0)::numeric as profit,
          case
            when coalesce(sum(f.labour_count), 0) > 0
            then coalesce(sum(f.area), 0) / sum(f.labour_count)
            else 0::numeric
          end as productivity
        from filtered f
        left join indr.layer l
          on l.project_id = f.project_id
         and indr.norm_text(l.application) = indr.norm_text(f.application)
         and (
              indr.norm_text(coalesce(l.flat_id, '')) = indr.norm_text(f.flat_id)
           or indr.norm_text(coalesce(l.flat, '')) = indr.norm_text(f.flat_id)
           or regexp_replace(coalesce(l.flat_id, l.flat, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(f.flat_id, ''), '[^0-9]', '', 'g')
         )
         and indr.norm_text(l.layer_name) = indr.norm_text(f.work_layer)
        where f.work_date is not null
        group by
          f.work_date,
          f.application,
          f.flat_id,
          f.work_layer
        order by
          f.work_date desc,
          f.application,
          f.flat_id,
          layer_order,
          f.work_layer
      `
        : Promise.resolve([] as any[]),

      needsTrend
        ? this.prisma.$queryRaw<any[]>`
        with filtered as (
          select *
          from public.mv_project_work_performance
          where ${whereSql}
            and work_date is not null
        ),

        costing as (
          select
            project_id,
            application,
            flat_id,
            layer_name,
            max(
              coalesce(
                nullif(productivity, 0),
                case
                  when coalesce(target_labour_days, 0) > 0
                   and coalesce(total_area_sft, 0) > 0
                  then total_area_sft / target_labour_days
                  else null::numeric
                end
              )
            )::numeric as target_productivity,
            max(nullif(material_coverage, 0))::numeric as target_coverage
          from indr.project_flat_layer_costing
          where project_id = ${projectId}
          group by project_id, application, flat_id, layer_name
        ),

        flat_area as (
          select
            project_id,
            application,
            flat_id,
            max(total_area_ft)::numeric as flat_area
          from public.v_project_surface_area_base
          where project_id = ${projectId}
          group by project_id, application, flat_id
        ),

        labour_target as (
          select
            project_id,
            application,
            work_layer,
            max(target_days)::numeric as target_days
          from public.v_project_target_labour_lookup
          where project_id = ${projectId}
          group by project_id, application, work_layer
        )

        select
          date_trunc('month', f.work_date)::date as month_start,
          f.block,
          f.application,
          f.flat_id,
          f.work_layer,
          coalesce(f.material_name, '')::text as material_name,
          coalesce(min(f.layer_order), 999)::numeric as layer_order,

          coalesce(sum(
            case
              when coalesce(f.area, 0) > 0
               and coalesce(f.labour_count, 0) > 0
              then f.area
              else 0::numeric
            end
          ), 0)::numeric as productivity_area,

          coalesce(sum(
            case
              when coalesce(f.area, 0) > 0
               and coalesce(f.labour_count, 0) > 0
              then f.labour_count
              else 0::numeric
            end
          ), 0)::numeric as labour_days,

          coalesce(sum(
            case
              when trim(coalesce(f.material_name, '')) <> ''
               and coalesce(f.area, 0) > 0
               and coalesce(f.material_used_l_kg, 0) > 0
              then f.area
              else 0::numeric
            end
          ), 0)::numeric as coverage_area,

          coalesce(sum(
            case
              when trim(coalesce(f.material_name, '')) <> ''
               and coalesce(f.area, 0) > 0
               and coalesce(f.material_used_l_kg, 0) > 0
              then f.material_used_l_kg
              else 0::numeric
            end
          ), 0)::numeric as material_used,

          max(
            coalesce(
              c.target_productivity,
              case
                when coalesce(lt.target_days, 0) > 0
                 and coalesce(fa.flat_area, 0) > 0
                then fa.flat_area / lt.target_days
                else null::numeric
              end
            )
          )::numeric as target_productivity,

          max(c.target_coverage)::numeric as target_coverage

        from filtered f
        left join costing c
          on c.project_id = f.project_id
         and indr.norm_text(c.application) = indr.norm_text(f.application)
         and indr.norm_text(c.flat_id) = indr.norm_text(f.flat_id)
         and indr.norm_text(c.layer_name) = indr.norm_text(f.work_layer)
        left join flat_area fa
          on fa.project_id = f.project_id
         and indr.norm_text(fa.application) = indr.norm_text(f.application)
         and indr.norm_text(fa.flat_id) = indr.norm_text(f.flat_id)
        left join labour_target lt
          on lt.project_id = f.project_id
         and indr.norm_text(lt.application) = indr.norm_text(f.application)
         and indr.norm_text(lt.work_layer) = indr.norm_text(f.work_layer)
        group by
          date_trunc('month', f.work_date)::date,
          f.block,
          f.application,
          f.flat_id,
          f.work_layer,
          coalesce(f.material_name, '')
        order by
          month_start,
          f.application,
          f.flat_id,
          layer_order,
          f.work_layer,
          material_name
      `
        : Promise.resolve([] as any[]),

      needsFlatDetail
        ? this.prisma.$queryRaw<any[]>`
        with filtered as (
          select *
          from analytics_cache.mv_work_performance
          where ${whereSql}
        ),

        filtered_flats as (
          select distinct project_id, application, flat_id
          from filtered
        ),

        target_plan as (
          select
            project_id,
            application,
            work_layer,
            max(target_days)::numeric as target_days
          from public.v_project_target_labour_lookup
          where project_id = ${projectId}
            and ${targetLayerCondition}
          group by project_id, application, work_layer
        ),

        flat_target_plan as (
          select
            ff.application,
            ff.flat_id,
            tp.work_layer,
            tp.target_days,
            coalesce(min(l."order"), 999)::numeric as layer_order
          from filtered_flats ff
          join target_plan tp
            on tp.project_id = ff.project_id
           and indr.norm_text(tp.application) = indr.norm_text(ff.application)
          left join indr.layer l
            on l.project_id = ff.project_id
           and indr.norm_text(l.application) = indr.norm_text(ff.application)
           and (
                indr.norm_text(coalesce(l.flat_id, '')) = indr.norm_text(ff.flat_id)
             or indr.norm_text(coalesce(l.flat, '')) = indr.norm_text(ff.flat_id)
             or regexp_replace(coalesce(l.flat_id, l.flat, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(ff.flat_id, ''), '[^0-9]', '', 'g')
           )
           and indr.norm_text(l.layer_name) = indr.norm_text(tp.work_layer)
          group by ff.application, ff.flat_id, tp.work_layer, tp.target_days
        ),

        booked as (
          select
            f.work_date,
            f.application,
            f.flat_id,
            f.work_layer,
            coalesce(string_agg(distinct nullif(trim(f.material_name), ''), ', '), '')::text as material_names,
            coalesce(min(l."order"), 999)::numeric as layer_order,
            bool_or(f.is_billable)::boolean as is_billable,
            coalesce(sum(f.area), 0)::numeric as area,
            coalesce(sum(f.labour_count), 0)::numeric as labour_days,
            coalesce(sum(f.booked_days), 0)::numeric as booked_days,
            coalesce(sum(f.labour_cost), 0)::numeric as labour,
            coalesce(sum(f.material_cost), 0)::numeric as material,
            coalesce(sum(f.client_value), 0)::numeric as revenue,
            coalesce(sum(f.profit), 0)::numeric as profit
          from filtered f
          left join indr.layer l
            on l.project_id = f.project_id
           and indr.norm_text(l.application) = indr.norm_text(f.application)
           and (
                indr.norm_text(coalesce(l.flat_id, '')) = indr.norm_text(f.flat_id)
             or indr.norm_text(coalesce(l.flat, '')) = indr.norm_text(f.flat_id)
             or regexp_replace(coalesce(l.flat_id, l.flat, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(f.flat_id, ''), '[^0-9]', '', 'g')
           )
           and indr.norm_text(l.layer_name) = indr.norm_text(f.work_layer)
          group by
            f.work_date,
            f.application,
            f.flat_id,
            f.work_layer
        )

        select
          b.work_date,
          coalesce(b.application, p.application) as application,
          coalesce(b.flat_id, p.flat_id) as flat_id,
          coalesce(b.work_layer, p.work_layer) as work_layer,
          coalesce(b.material_names, '')::text as material_names,
          coalesce(b.layer_order, p.layer_order, 999)::numeric as layer_order,
          coalesce(b.is_billable, false)::boolean as is_billable,
          coalesce(b.area, 0)::numeric as area,
          coalesce(b.labour_days, 0)::numeric as labour_days,
          coalesce(b.booked_days, 0)::numeric as booked_days,
          coalesce(p.target_days, 0)::numeric as target_days,
          (
            coalesce(b.booked_days, 0)
            - coalesce(p.target_days, 0)
          )::numeric as vs_target,
          case
            when coalesce(p.target_days, 0) > 0
            then coalesce(b.booked_days, 0) * 100 / p.target_days
            else null::numeric
          end as target_use_pct,
          coalesce(b.labour, 0)::numeric as labour,
          coalesce(b.material, 0)::numeric as material,
          coalesce(b.revenue, 0)::numeric as revenue,
          coalesce(b.profit, 0)::numeric as profit,
          case
            when coalesce(b.revenue, 0) > 0
            then coalesce(b.profit, 0) * 100 / b.revenue
            else 0::numeric
          end as margin,
          case
            when coalesce(b.labour_days, 0) > 0
            then coalesce(b.area, 0) / b.labour_days
            else 0::numeric
          end as productivity
        from flat_target_plan p
        full join booked b
          on indr.norm_text(b.application) = indr.norm_text(p.application)
         and indr.norm_text(b.flat_id) = indr.norm_text(p.flat_id)
         and indr.norm_text(b.work_layer) = indr.norm_text(p.work_layer)
        order by
          coalesce(b.application, p.application),
          coalesce(b.flat_id, p.flat_id),
          coalesce(b.work_date, '9999-12-31'::date),
          coalesce(b.layer_order, p.layer_order, 999),
          coalesce(b.work_layer, p.work_layer)
      `
        : Promise.resolve([] as any[]),

      // The current Analytics frontend derives Cost Analysis from KPI,
      // applicationSummary and flatSummary. These five legacy SQL result sets
      // are not consumed by page.tsx, so running them only adds DB latency.
      // Keep the array positions/response shape for backward compatibility.
      Promise.resolve([] as any[]), // costStructureRows
      Promise.resolve([] as any[]), // costDistributionRows
      Promise.resolve([] as any[]), // costDrillDownRows
      Promise.resolve([] as any[]), // nonBillableCostRows
      Promise.resolve([] as any[]), // noAreaCostRows

      needsBudget
        ? this.prisma.$queryRaw<any[]>`
        with filtered as (
          select *
          from analytics_cache.mv_budget_flat_layer
          where ${budgetWhereSql}
        ),
        flat_area as (
          select
            application,
            flat_id,
            max(budget_area)::numeric as budget_area,
            max(flat_progress_pct)::numeric as flat_progress_pct
          from filtered
          group by application, flat_id
        ),
        application_area as (
          select
            application,
            coalesce(sum(budget_area), 0)::numeric as budget_area,
            coalesce(avg(flat_progress_pct), 0)::numeric as progress_pct
          from flat_area
          group by application
        ),
        metric_rollup as (
          select
            application,
            count(distinct flat_id)::numeric as flats,
            coalesce(sum(budget_cost), 0)::numeric as budget_cost,
            coalesce(sum(expected_cost), 0)::numeric as expected_cost,
            case when coalesce(sum(budget_cost), 0) > 0 then coalesce(sum(expected_cost), 0) * 100 / sum(budget_cost) else 0::numeric end as expected_progress_pct,
            coalesce(sum(actual_cost), 0)::numeric as actual_cost,
            coalesce(sum(budget_labour_days), 0)::numeric as budget_days,
            coalesce(sum(expected_labour_days), 0)::numeric as expected_days,
            coalesce(sum(actual_labour_days), 0)::numeric as actual_days,
            coalesce(sum(budget_material_cost), 0)::numeric as budget_material,
            coalesce(sum(expected_material_cost), 0)::numeric as expected_material,
            coalesce(sum(actual_material_cost), 0)::numeric as actual_material,
            coalesce(sum(actual_entries), 0)::numeric as entries
          from filtered
          group by application
        )
        select
          mr.application,
          mr.flats,
          coalesce(aa.budget_area, 0)::numeric as budget_area,
          coalesce(aa.progress_pct, 0)::numeric as progress_pct,
          mr.budget_cost,
          mr.expected_cost,
          mr.expected_progress_pct,
          mr.actual_cost,
          (mr.actual_cost - mr.expected_cost)::numeric as variance,
          case
            when mr.expected_cost > 0 then (mr.actual_cost - mr.expected_cost) * 100 / mr.expected_cost
            when mr.expected_cost = 0 and mr.actual_cost > 0 then 100::numeric
            else 0::numeric
          end as var_pct,
          mr.budget_days,
          mr.expected_days,
          mr.actual_days,
          mr.budget_material,
          mr.expected_material,
          mr.actual_material,
          mr.entries,
          case
            when (
              case
                when mr.expected_cost > 0 then (mr.actual_cost - mr.expected_cost) * 100 / mr.expected_cost
                when mr.expected_cost = 0 and mr.actual_cost > 0 then 100::numeric
                else 0::numeric
              end
            ) > 5 then 'Critical'
            when (
              case
                when mr.expected_cost > 0 then (mr.actual_cost - mr.expected_cost) * 100 / mr.expected_cost
                when mr.expected_cost = 0 and mr.actual_cost > 0 then 100::numeric
                else 0::numeric
              end
            ) > 0 then 'Over Budget'
            when (
              case
                when mr.expected_cost > 0 then (mr.actual_cost - mr.expected_cost) * 100 / mr.expected_cost
                when mr.expected_cost = 0 and mr.actual_cost > 0 then 100::numeric
                else 0::numeric
              end
            ) >= -5 then 'On Track'
            else 'Under Budget'
          end as status
        from metric_rollup mr
        left join application_area aa
          on aa.application = mr.application
        order by mr.application
      `
        : Promise.resolve([] as any[]),

      needsBudget
        ? this.prisma.$queryRaw<any[]>`
        with budget_base as (
          select *
          from analytics_cache.mv_budget_flat_layer
          where ${budgetWhereSql}
        ),
        actual_extra as (
          select
            project_id, application, flat_id, work_layer,
            coalesce(sum(material_used_l_kg), 0)::numeric as actual_material_qty,
            coalesce(sum(client_value), 0)::numeric as actual_revenue
          from analytics_cache.mv_work_performance
          where ${whereSql}
          group by project_id, application, flat_id, work_layer
        ),
        costing_extra as (
          select
            project_id, application, flat_id, layer_name,
            max(coalesce(revenue, 0))::numeric as budget_revenue,
            max(nullif(material_coverage, 0))::numeric as material_coverage,
            max(nullif(material_rate_per_unit, 0))::numeric as material_rate_per_unit
          from indr.project_flat_layer_costing
          where project_id = ${projectId}
          group by project_id, application, flat_id, layer_name
        )
        select
          b.application,
          b.flat_id,
          b.block,
          b.work_layer,
          coalesce(layer_sequence.layer_order, 999)::numeric as layer_order,
          b.is_billable,
          b.budget_area,
          b.layer_progress_pct,
          b.flat_progress_pct,
          b.expected_progress_pct,
          b.is_running_flat,
          b.material_names,
          b.budget_material_qty,
          b.budget_material_cost,
          b.budget_labour_days,
          b.budget_labour_cost,
          b.budget_cost,
          b.expected_material_qty,
          b.expected_material_cost,
          b.expected_labour_days,
          b.expected_labour_cost,
          b.expected_cost,
          b.actual_material_cost,
          b.actual_labour_cost,
          b.actual_cost,
          b.actual_labour_days,
          b.actual_area,
          coalesce(ae.actual_material_qty, 0)::numeric as actual_material_qty,
          coalesce(ce.budget_revenue, 0)::numeric as budget_revenue,
          (coalesce(ce.budget_revenue, 0) * coalesce(b.layer_progress_pct, 0) / 100)::numeric as expected_revenue,
          coalesce(ae.actual_revenue, 0)::numeric as actual_revenue,
          coalesce(ce.material_coverage, 0)::numeric as material_coverage,
          coalesce(ce.material_rate_per_unit, 0)::numeric as material_rate_per_unit,
          b.actual_entries,
          b.variance,
          b.var_pct,
          b.status
        from budget_base b
        left join lateral (
          select
            min(coalesce(l."order", 999))::numeric as layer_order
          from indr.layer l
          where l.project_id = b.project_id
            and indr.norm_text(l.application) = indr.norm_text(b.application)
            and (
                 indr.norm_text(coalesce(l.flat_id, '')) = indr.norm_text(b.flat_id)
              or indr.norm_text(coalesce(l.flat, '')) = indr.norm_text(b.flat_id)
              or regexp_replace(coalesce(l.flat_id, l.flat, ''), '[^0-9]', '', 'g')
                 = regexp_replace(coalesce(b.flat_id, ''), '[^0-9]', '', 'g')
            )
            and indr.norm_text(l.layer_name) = indr.norm_text(b.work_layer)
        ) layer_sequence on true
        left join actual_extra ae
          on ae.project_id = b.project_id
         and indr.norm_text(ae.application) = indr.norm_text(b.application)
         and indr.norm_text(ae.flat_id) = indr.norm_text(b.flat_id)
         and indr.norm_text(ae.work_layer) = indr.norm_text(b.work_layer)
        left join costing_extra ce
          on ce.project_id = b.project_id
         and indr.norm_text(ce.application) = indr.norm_text(b.application)
         and indr.norm_text(ce.flat_id) = indr.norm_text(b.flat_id)
         and indr.norm_text(ce.layer_name) = indr.norm_text(b.work_layer)
        order by
          b.application,
          b.flat_id,
          coalesce(layer_sequence.layer_order, 999),
          b.work_layer
      `
        : Promise.resolve([] as any[]),

      needsBudget
        ? this.prisma.$queryRaw<any[]>`
        with filtered as (
          select *
          from analytics_cache.mv_work_performance
          where ${whereSql}
            and work_date is not null
        ),
        costing as (
          select
            project_id,
            application,
            flat_id,
            layer_name,
            max(coalesce(nullif(productivity, 0), case when coalesce(target_labour_days, 0) > 0 and coalesce(total_area_sft, 0) > 0 then total_area_sft / target_labour_days else 0 end))::numeric as target_productivity,
            max(coalesce(material_coverage, 0))::numeric as material_coverage,
            max(coalesce(material_rate_per_unit, 0))::numeric as material_rate_per_unit,
            max(case when coalesce(target_labour_days, 0) > 0 then coalesce(labour_cost, 0) / target_labour_days else coalesce(per_labour_cost, 0) end)::numeric as labour_rate
          from indr.project_flat_layer_costing
          where project_id = ${projectId}
          group by project_id, application, flat_id, layer_name
        ),
        enriched as (
          select
            f.work_date,
            f.area,
            f.labour_count,
            f.labour_cost,
            f.material_cost,
            f.material_used_l_kg,
            coalesce(c.target_productivity, 0)::numeric as target_productivity,
            coalesce(c.material_coverage, 0)::numeric as material_coverage,
            coalesce(c.material_rate_per_unit, 0)::numeric as material_rate_per_unit,
            coalesce(c.labour_rate, 0)::numeric as labour_rate
          from filtered f
          left join costing c
            on c.project_id = f.project_id
           and indr.norm_text(c.application) = indr.norm_text(f.application)
           and indr.norm_text(c.flat_id) = indr.norm_text(f.flat_id)
           and indr.norm_text(c.layer_name) = indr.norm_text(f.work_layer)
        )
        select
          work_date,
          count(*)::numeric as entries,
          coalesce(sum(area), 0)::numeric as area,
          coalesce(sum(labour_count), 0)::numeric as labour_days,
          coalesce(sum(case when area > 0 and labour_count > 0 then area else 0 end), 0)::numeric as measured_area,
          coalesce(sum(case when area > 0 and labour_count > 0 then labour_count else 0 end), 0)::numeric as measured_days,
          coalesce(sum(material_used_l_kg), 0)::numeric as material_qty,
          coalesce(sum(labour_cost), 0)::numeric as actual_labour,
          coalesce(sum(case when target_productivity > 0 then (area / target_productivity) * labour_rate else 0 end), 0)::numeric as expected_labour,
          coalesce(sum(material_cost), 0)::numeric as actual_material,
          coalesce(sum(case when material_coverage > 0 then (area / material_coverage) * material_rate_per_unit else 0 end), 0)::numeric as expected_material,
          coalesce(sum(labour_cost + material_cost), 0)::numeric as actual_cost,
          coalesce(sum(
            (case when target_productivity > 0 then (area / target_productivity) * labour_rate else 0 end)
            + (case when material_coverage > 0 then (area / material_coverage) * material_rate_per_unit else 0 end)
          ), 0)::numeric as expected_cost
        from enriched
        group by work_date
        order by work_date
      `
        : Promise.resolve([] as any[]),
    ]);

    const row = kpiRows[0] || {};

    const clientValue = toNumber(row.client_value);
    const netProfit = toNumber(row.net_profit);
    const costStructure = costStructureRows[0] || {};

    const flatDetailMap = new Map<string, any[]>();

    flatDetailRows.forEach((item) => {
      const application = String(item.application || '');
      const flatId = String(item.flat_id || '');
      const key = `${application}__${flatId}`;
      const current = flatDetailMap.get(key) || [];
      const bookedDays = toNumber(item.booked_days || item.labour_days);
      const targetDays = toNumber(item.target_days);

      current.push({
        workDate:
          item.work_date instanceof Date
            ? item.work_date.toISOString().slice(0, 10)
            : String(item.work_date || ''),
        workLayer: String(item.work_layer || ''),
        materialNames: String(item.material_names || ''),
        isBillable: Boolean(item.is_billable),
        layerOrder: toNumber(item.layer_order || 999),
        entries: toNumber(item.entries || 0),
        area: toNumber(item.area),
        labourDays: toNumber(item.labour_days),
        bookedDays,
        targetDays,
        vsTarget: toNumber(item.vs_target || bookedDays - targetDays),
        targetUsePct: toNumber(
          item.target_use_pct || (targetDays > 0 ? (bookedDays * 100) / targetDays : 0),
        ),
        labour: toNumber(item.labour),
        material: toNumber(item.material),
        revenue: toNumber(item.revenue),
        profit: toNumber(item.profit),
        margin: toNumber(item.margin),
        productivity: toNumber(item.productivity),
      });

      flatDetailMap.set(key, current);
    });

    const kpiBookedDays = toNumber(row.booked_days || row.labour_days);
    const kpiTargetDays = toNumber(row.target_days);

    return {
      recordCount: toNumber(row.record_count),

      kpis: {
        applications: toNumber(row.applications),
        flatsWorked: toNumber(row.flats_worked),

        totalArea: toNumber(row.total_project_area),
        executedArea: toNumber(row.executed_area),

        clientValue,
        labourCost: toNumber(row.labour_cost),
        materialCost: toNumber(row.material_cost),
        netProfit,

        profitMargin: clientValue > 0 ? (netProfit * 100) / clientValue : 0,

        productivity: toNumber(row.productivity),
        labourDays: toNumber(row.labour_days),
        bookedDays: kpiBookedDays,
        targetDays: kpiTargetDays,
        vsTarget: toNumber(row.vs_target || kpiBookedDays - kpiTargetDays),
        targetUsePct: toNumber(
          row.target_use_pct ||
            (kpiTargetDays > 0 ? (kpiBookedDays * 100) / kpiTargetDays : 0),
        ),

        flatsInProfit: toNumber(row.flats_in_profit),
        flatsInLoss: toNumber(row.flats_in_loss),

        nonBillableOperationalWork: toNumber(
          row.non_billable_operational_work,
        ),
        nonBillableEntries: toNumber(row.non_billable_entries),

        flatsBelow50Productivity: toNumber(
          row.flats_below_50_productivity,
        ),
        flatsBelow60Productivity: toNumber(row.flats_below_60_productivity),
        flatsWithLayersToBook: toNumber(row.flats_with_layers_to_book),
        targetBookedDays: toNumber(row.target_booked_days),
        actualBookedTargetedDays: toNumber(row.actual_booked_targeted_days),
        bookedVsTarget: toNumber(row.actual_booked_targeted_days) - toNumber(row.target_booked_days),
        bookedTargetUsePct: toNumber(row.target_booked_days) > 0
          ? (toNumber(row.actual_booked_targeted_days) * 100) / toNumber(row.target_booked_days)
          : 0,
        untargetedDays: toNumber(row.untargeted_days),
        labourValueGap: toNumber(row.actual_booked_targeted_days) > 0
          ? (toNumber(row.actual_booked_targeted_days) - toNumber(row.target_booked_days))
            * (toNumber(row.targeted_labour_cost) / toNumber(row.actual_booked_targeted_days))
          : 0,
      },

      applicationSummary: applicationSummaryRows.map((item) => {
        const bookedDays = toNumber(item.booked_days || item.labour_days);
        const targetDays = toNumber(item.target_days);

        return {
          application: String(item.application || ''),
          flats: toNumber(item.flats),
          entries: toNumber(item.entries),
          targetPerFlat: toNumber(item.target_per_flat),
          targetBooked: toNumber(item.target_booked),
          actualBooked: toNumber(item.actual_booked),
          bookedVsTarget: toNumber(item.booked_vs_target),
          bookedTargetUsePct: toNumber(item.booked_target_use_pct),
          untargetedDays: toNumber(item.untargeted_days),
          untargetedLayers: toNumber(item.untargeted_layers),
          targetedLabourRate: toNumber(item.targeted_labour_rate),
          labourValueGap: toNumber(item.labour_value_gap),
          labourDays: toNumber(item.labour_days),
          bookedDays,
          targetDays,
          vsTarget: toNumber(item.vs_target || bookedDays - targetDays),
          targetUsePct: toNumber(
            item.target_use_pct ||
              (targetDays > 0 ? (bookedDays * 100) / targetDays : 0),
          ),
          area: toNumber(item.area),
          labour: toNumber(item.labour),
          material: toNumber(item.material),
          revenue: toNumber(item.revenue),
          netProfit: toNumber(item.net_profit),
          margin: toNumber(item.margin),
          productivity: toNumber(item.productivity),
          profitPerSqft: toNumber(item.profit_per_sqft),
        };
      }),

      flatSummary: flatSummaryRows.map((item) => {
        const application = String(item.application || '');
        const flatId = String(item.flat_id || '');
        const bookedDays = toNumber(item.booked_days || item.labour_days);
        const targetDays = toNumber(item.target_days);

        return {
          application,
          flatId,
          targetPerFlat: toNumber(item.target_per_flat),
          targetBooked: toNumber(item.target_booked),
          actualBooked: toNumber(item.actual_booked),
          bookedVsTarget: toNumber(item.booked_vs_target),
          bookedTargetUsePct: toNumber(item.booked_target_use_pct),
          untargetedDays: toNumber(item.untargeted_days),
          untargetedLayers: toNumber(item.untargeted_layers),
          targetedLabourRate: toNumber(item.targeted_labour_rate),
          labourValueGap: toNumber(item.labour_value_gap),
          bookedLayers: toNumber(item.booked_layers),
          entryCount: toNumber(item.entries),
          totalLayers: toNumber(item.total_layers),
          labourDays: toNumber(item.labour_days),
          bookedDays,
          targetDays,
          vsTarget: toNumber(item.vs_target || bookedDays - targetDays),
          targetUsePct: toNumber(
            item.target_use_pct ||
              (targetDays > 0 ? (bookedDays * 100) / targetDays : 0),
          ),
          area: toNumber(item.area),
          labour: toNumber(item.labour),
          material: toNumber(item.material),
          revenue: toNumber(item.revenue),
          netProfit: toNumber(item.net_profit),
          margin: toNumber(item.margin),
          productivity: toNumber(item.productivity),
          profitPerSqft: toNumber(item.profit_per_sqft),
          details: flatDetailMap.get(`${application}__${flatId}`) || [],
        };
      }),

      dailyProfitTrend: dailyTrendRows.map((item) => {
        const bookedDays = toNumber(item.booked_days || item.labour_days);
        const targetDays = toNumber(item.target_days);

        return {
          workDate:
            item.work_date instanceof Date
              ? item.work_date.toISOString().slice(0, 10)
              : String(item.work_date || ''),
          profit: toNumber(item.profit),
          labourDays: toNumber(item.labour_days),
          bookedDays,
          targetDays,
          vsTarget: toNumber(item.vs_target || bookedDays - targetDays),
          targetUsePct: toNumber(
            item.target_use_pct ||
              (targetDays > 0 ? (bookedDays * 100) / targetDays : 0),
          ),
          revenue: toNumber(item.revenue),
          labour: toNumber(item.labour),
          material: toNumber(item.material),
        };
      }),

      dateTimeline: buildDateTimeline(dateTimelineRows),

      trendAnalysis: needsTrend
        ? {
            availableMonths: Array.from(
              new Set(
                trendRows
                  .map((item) => {
                    const value = item.month_start;
                    if (value instanceof Date) return value.toISOString().slice(0, 7);
                    return String(value || '').slice(0, 7);
                  })
                  .filter(Boolean),
              ),
            ).sort(),
            rows: trendRows.map((item) => ({
              month:
                item.month_start instanceof Date
                  ? item.month_start.toISOString().slice(0, 7)
                  : String(item.month_start || '').slice(0, 7),
              application: String(item.application || ''),
              block: String(item.block || ''),
              flatId: String(item.flat_id || ''),
              workLayer: String(item.work_layer || ''),
              materialName: String(item.material_name || ''),
              layerOrder: toNumber(item.layer_order || 999),
              productivityArea: toNumber(item.productivity_area),
              labourDays: toNumber(item.labour_days),
              coverageArea: toNumber(item.coverage_area),
              materialUsed: toNumber(item.material_used),
              targetProductivity: toNumber(item.target_productivity),
              targetCoverage: toNumber(item.target_coverage),
            })),
          }
        : undefined,

      costAnalysis: {
        structure: {
          areaBearingEntries: toNumber(costStructure.area_bearing_entries),
          area: toNumber(costStructure.area),
          revenuePerSqft: toNumber(costStructure.revenue_per_sqft),
          labourPerSqft: toNumber(costStructure.labour_per_sqft),
          materialPerSqft: toNumber(costStructure.material_per_sqft),
          totalCostPerSqft: toNumber(costStructure.total_cost_per_sqft),
          profitPerSqft: toNumber(costStructure.profit_per_sqft),
          nonBillableCost: toNumber(costStructure.non_billable_cost),
        },
        distributionByApplication: costDistributionRows.map((item) => {
          const bookedDays = toNumber(item.booked_days || item.reported_labour_days);
          const targetDays = toNumber(item.target_days);

          return {
            application: String(item.application || ''),
            labour: toNumber(item.labour),
            material: toNumber(item.material),
            profit: toNumber(item.profit),
            costAboveRevenue: toNumber(item.cost_above_revenue),
            revenue: toNumber(item.revenue),
            reportedLabourDays: toNumber(item.reported_labour_days),
            bookedDays,
            targetDays,
            vsTarget: toNumber(item.vs_target || bookedDays - targetDays),
            targetUsePct: toNumber(
              item.target_use_pct ||
                (targetDays > 0 ? (bookedDays * 100) / targetDays : 0),
            ),
          };
        }),
        drillDownRows: costDrillDownRows.map((item) => {
          const bookedDays = toNumber(item.booked_days || item.labour_days);
          const targetDays = toNumber(item.target_days);

          return {
            application: String(item.application || ''),
            flatId: String(item.flat_id || ''),
            workLayer: String(item.work_layer || ''),
            isBillable: Boolean(item.is_billable),
            layerOrder: toNumber(item.layer_order || 999),
            entries: toNumber(item.entries || 0),
            area: toNumber(item.area),
            labourDays: toNumber(item.labour_days),
            bookedDays,
            targetDays,
            vsTarget: toNumber(item.vs_target || bookedDays - targetDays),
            targetUsePct: toNumber(
              item.target_use_pct ||
                (targetDays > 0 ? (bookedDays * 100) / targetDays : 0),
            ),
            labour: toNumber(item.labour),
            material: toNumber(item.material),
            revenue: toNumber(item.revenue),
            profit: toNumber(item.profit),
            labourPerSqft: toNumber(item.labour_per_sqft),
            materialPerSqft: toNumber(item.material_per_sqft),
            costPerSqft: toNumber(item.cost_per_sqft),
            revenuePerSqft: toNumber(item.revenue_per_sqft),
            profitPerSqft: toNumber(item.profit_per_sqft),
          };
        }),
        nonBillableOperationalWork: costGroupedRows(nonBillableCostRows),
        activitiesWithoutMeasurableArea: costGroupedRows(noAreaCostRows),
      },

      budgetCostControl: {
        applicationSummary: budgetApplicationRows.map((item) => ({
          application: String(item.application || ''),
          flats: toNumber(item.flats),
          budgetArea: toNumber(item.budget_area),
          progressPct: toNumber(item.progress_pct),
          expectedProgressPct: toNumber(item.expected_progress_pct),
          progress: toNumber(item.progress_pct),
          budgetCost: toNumber(item.budget_cost),
          expectedCost: toNumber(item.expected_cost),
          actualCost: toNumber(item.actual_cost),
          variance: toNumber(item.variance),
          varPct: toNumber(item.var_pct),
          budgetDays: toNumber(item.budget_days),
          expectedDays: toNumber(item.expected_days),
          actualDays: toNumber(item.actual_days),
          budgetMaterial: toNumber(item.budget_material),
          expectedMaterial: toNumber(item.expected_material),
          actualMaterial: toNumber(item.actual_material),
          entries: toNumber(item.entries),
          status: String(item.status || 'On Track'),
        })),
        flatDrilldownRows: budgetFlatLayerRows.map((item) => ({
          application: String(item.application || ''),
          flatId: String(item.flat_id || ''),
          block: String(item.block || ''),
          workLayer: String(item.work_layer || ''),
          layerOrder: toNumber(item.layer_order || 999),
          isBillable: Boolean(item.is_billable),
          budgetArea: toNumber(item.budget_area),
          layerProgressPct: toNumber(item.layer_progress_pct),
          flatProgressPct: toNumber(item.flat_progress_pct),
          expectedProgressPct: toNumber(item.expected_progress_pct),
          progress: toNumber(item.layer_progress_pct),
          flatProgress: toNumber(item.flat_progress_pct),
          isRunningFlat: Boolean(item.is_running_flat),
          materialNames: String(item.material_names || ''),
          budgetMaterialQty: toNumber(item.budget_material_qty),
          budgetMaterial: toNumber(item.budget_material_cost),
          budgetDays: toNumber(item.budget_labour_days),
          budgetLabour: toNumber(item.budget_labour_cost),
          budgetCost: toNumber(item.budget_cost),
          expectedMaterialQty: toNumber(item.expected_material_qty),
          expectedMaterial: toNumber(item.expected_material_cost),
          expectedDays: toNumber(item.expected_labour_days),
          expectedLabour: toNumber(item.expected_labour_cost),
          expectedCost: toNumber(item.expected_cost),
          actualMaterial: toNumber(item.actual_material_cost),
          actualLabour: toNumber(item.actual_labour_cost),
          actualCost: toNumber(item.actual_cost),
          actualDays: toNumber(item.actual_labour_days),
          actualArea: toNumber(item.actual_area),
          actualMaterialQty: toNumber(item.actual_material_qty),
          budgetRevenue: toNumber(item.budget_revenue),
          expectedRevenue: toNumber(item.expected_revenue),
          actualRevenue: toNumber(item.actual_revenue),
          materialCoverage: toNumber(item.material_coverage),
          materialRatePerUnit: toNumber(item.material_rate_per_unit),
          entries: toNumber(item.actual_entries),
          variance: toNumber(item.variance),
          varPct: toNumber(item.var_pct),
          status: String(item.status || 'On Track'),
        })),
        trendRows: budgetTrendRows.map((item) => ({
          workDate:
            item.work_date instanceof Date
              ? item.work_date.toISOString().slice(0, 10)
              : String(item.work_date || ''),
          entries: toNumber(item.entries),
          area: toNumber(item.area),
          labourDays: toNumber(item.labour_days),
          measuredArea: toNumber(item.measured_area),
          measuredDays: toNumber(item.measured_days),
          materialQty: toNumber(item.material_qty),
          actualLabour: toNumber(item.actual_labour),
          expectedLabour: toNumber(item.expected_labour),
          actualMaterial: toNumber(item.actual_material),
          expectedMaterial: toNumber(item.expected_material),
          actualCost: toNumber(item.actual_cost),
          expectedCost: toNumber(item.expected_cost),
        })),
      },
    };
  }
}