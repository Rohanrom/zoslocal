import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type BoqCostingDbRow = {
  Block: string | null;
  Application: string | null;
  Layer: string | null;
  Area: unknown;
  'Material Name': string | null;
  'Client Rate': unknown;
  'Material Cost': unknown;
  'Total Amount': unknown;
  'Expected Material Consumption': unknown;
  'Expected Labour Hours': unknown;
  'Average Daily Wage': unknown;
  Projected_Profit: unknown;
  'Current Stock': unknown;
};

@Injectable()
export class BoqService {
  constructor(private readonly prisma: PrismaService) {}

  async getBoqCosting(projectIdInput: string) {
    const projectId = String(projectIdInput || '').trim();

    // Preserve the current Park Heights BOQ view exactly as-is. New projects
    // use the generic project_flat_layer_costing source created by Project Setup.
    if (projectId === 'park_heights') {
      const rows = await this.prisma.$queryRaw<BoqCostingDbRow[]>`
        select
          "Block",
          "Application",
          "Layer",
          "Area",
          "Material Name",
          "Client Rate",
          "Material Cost",
          "Total Amount",
          "Expected Material Consumption",
          "Expected Labour Hours",
          "Average Daily Wage",
          "Projected_Profit",
          "Current Stock"
        from public.boq_costing
        order by
          "Block" asc nulls last,
          "Application" asc nulls last,
          "Layer" asc nulls last,
          "Material Name" asc nulls last
      `;

      return rows.map((row) => this.formatBoqCostingRow(row));
    }

    const rows = await this.prisma.$queryRaw<BoqCostingDbRow[]>`
      select
        c.block as "Block",
        c.application as "Application",
        c.layer_name as "Layer",
        sum(coalesce(c.total_area_sft, 0))::numeric as "Area",
        max(c.material_name) as "Material Name",
        max(c.client_rate)::numeric as "Client Rate",
        sum(coalesce(c.material_cost, 0))::numeric as "Material Cost",
        sum(coalesce(c.revenue, 0))::numeric as "Total Amount",
        sum(coalesce(c.material_required, 0))::numeric as "Expected Material Consumption",
        sum(coalesce(c.target_labour_days, 0) * 8)::numeric as "Expected Labour Hours",
        max(c.per_labour_cost)::numeric as "Average Daily Wage",
        sum(coalesce(c.margin, 0))::numeric as "Projected_Profit",
        null::numeric as "Current Stock"
      from indr.project_flat_layer_costing c
      where c.project_id = ${projectId}
      group by c.block, c.application, c.layer_name
      order by
        c.block asc nulls last,
        c.application asc nulls last,
        c.layer_name asc nulls last
    `;

    return rows.map((row) => this.formatBoqCostingRow(row));
  }

  /**
   * Read-only Work Order costing worksheet (legacy physical BOQ names remain).
   *
   * The first choice is the project-scoped flat × layer costing baseline that
   * Project Setup already generates. Summaries are grouped by the complete
   * costing-input combination, NOT just layer: a single layer can have
   * different materials/rates between blocks and must not be mixed together.
   *
   * Park Heights keeps a read-only fallback to public.boq_costing when its
   * newer generic costing table has no rows. The existing /costing endpoint
   * and all work-order import/production SQL remain untouched.
   */
  async getWorkOrderWorksheet(projectIdInput: string) {
    const projectId = String(projectIdInput || '').trim();
    if (!projectId) {
      return { projectId, source: 'project-costing', rows: [], areas: [] };
    }

    type GenericRow = {
      block: string | null;
      application: string | null;
      layer: string | null;
      area: unknown;
      flatCount: unknown;
      productivity: unknown;
      targetLabourDays: unknown;
      perLabourCost: unknown;
      labourCost: unknown;
      materialName: string | null;
      materialCoverage: unknown;
      materialRatePerUnit: unknown;
      materialRequired: unknown;
      materialCost: unknown;
      clientRate: unknown;
      revenue: unknown;
      margin: unknown;
    };

    const genericRows = await this.prisma.$queryRaw<GenericRow[]>`
      select
        c.block as block,
        c.application as application,
        c.layer_name as layer,
        sum(coalesce(c.total_area_sft, 0))::numeric as area,
        count(distinct c.flat_id)::bigint as "flatCount",
        c.productivity as productivity,
        case
          when c.productivity > 0
          then sum(c.target_labour_days)::numeric
          else null::numeric
        end as "targetLabourDays",
        c.per_labour_cost as "perLabourCost",
        case
          when c.productivity > 0 and c.per_labour_cost is not null
          then sum(c.labour_cost)::numeric
          else null::numeric
        end as "labourCost",
        c.material_name as "materialName",
        c.material_coverage as "materialCoverage",
        c.material_rate_per_unit as "materialRatePerUnit",
        case
          when c.material_name is null
          then 0::numeric
          when c.material_coverage > 0
          then sum(c.material_required)::numeric
          else null::numeric
        end as "materialRequired",
        case
          when c.material_name is null
          then 0::numeric
          when c.material_coverage > 0 and c.material_rate_per_unit is not null
          then sum(c.material_cost)::numeric
          else null::numeric
        end as "materialCost",
        c.client_rate as "clientRate",
        case
          when c.client_rate is not null
          then sum(c.revenue)::numeric
          else null::numeric
        end as revenue,
        case
          when c.client_rate is not null
            and c.productivity > 0
            and c.per_labour_cost is not null
            and (c.material_name is null
              or (c.material_coverage > 0 and c.material_rate_per_unit is not null))
          then sum(c.margin)::numeric
          else null::numeric
        end as margin
      from indr.project_flat_layer_costing c
      where c.project_id = ${projectId}
      group by
        c.block, c.application, c.layer_name,
        c.productivity, c.per_labour_cost,
        c.material_name, c.material_coverage,
        c.material_rate_per_unit, c.client_rate
      order by
        c.application nulls last,
        c.block nulls last,
        c.layer_name nulls last,
        c.material_name nulls last
    `;

    type AreaRow = { application: string | null; block: string | null; area: unknown };
    const toArea = (row: AreaRow) => ({
      application: row.application,
      block: row.block,
      area: this.toNullableNumber(row.area),
    });

    if (genericRows.length) {
      // Each flat is counted ONCE in the application's size-area KPI; do
      // not sum the area repeated for every layer in the costing table.
      const areas = await this.prisma.$queryRaw<AreaRow[]>`
        select application, block, sum(coalesce(total_area_sft, 0))::numeric as area
        from indr.flat_area_summary
        where project_id = ${projectId}
        group by application, block
        order by application, block
      `;

      const fallbackAreas = await this.prisma.$queryRaw<AreaRow[]>`
        select application, block, sum(area)::numeric as area
        from (
          select
            application, block, flat_id,
            max(coalesce(total_area_sft, 0))::numeric as area
          from indr.project_flat_layer_costing
          where project_id = ${projectId}
          group by application, block, flat_id
        ) f
        group by application, block
        order by application, block
      `;

      // Some older imported projects have costing rows but no refreshed
      // flat_area_summary. Use distinct flats from their costing rows then.
      const areaKeys = new Set(areas.map((a) => `${a.application}\x00${a.block}`));
      const availableAreas = areas.concat(
        fallbackAreas.filter((a) => !areaKeys.has(`${a.application}\x00${a.block}`)),
      );

      return {
        projectId,
        source: 'project-costing' as const,
        areas: availableAreas.map(toArea),
        rows: genericRows.map((r) => {
          const area = this.toNullableNumber(r.area);
          const materialCost = this.toNullableNumber(r.materialCost);
          return {
            block: r.block,
            application: r.application,
            layer: r.layer,
            area,
            flatCount: Number(r.flatCount ?? 0),
            productivity: this.toNullableNumber(r.productivity),
            targetLabourDays: this.toNullableNumber(r.targetLabourDays),
            perLabourCost: this.toNullableNumber(r.perLabourCost),
            labourCost: this.toNullableNumber(r.labourCost),
            materialName: r.materialName,
            consumptionPct: null, // Not imported/stored in current ZOS.
            materialCoverage: this.toNullableNumber(r.materialCoverage),
            materialRatePerUnit: this.toNullableNumber(r.materialRatePerUnit),
            materialRequired: this.toNullableNumber(r.materialRequired),
            materialCost,
            materialCostPerSft:
              area !== null && area > 0 && materialCost !== null
                ? materialCost / area
                : null,
            clientRate: this.toNullableNumber(r.clientRate),
            revenue: this.toNullableNumber(r.revenue),
            margin: this.toNullableNumber(r.margin),
          };
        }),
      };
    }

    // Legacy Park Heights: do not rewrite its existing costing logic.
    // Fields absent in this source remain null (not estimated from profit).
    if (projectId === 'park_heights') {
      const rows = await this.getBoqCosting(projectId);
      return {
        projectId,
        source: 'legacy-boq-costing' as const,
        areas: [],
        rows: rows.map((r) => ({
          block: r.block,
          application: r.application,
          layer: r.layer,
          area: r.area,
          flatCount: null,
          productivity: null,
          targetLabourDays:
            r.expectedLabourHours !== null
              ? r.expectedLabourHours / 8
              : null,
          perLabourCost: r.averageDailyWage,
          labourCost: null,
          materialName: r.materialName,
          consumptionPct: null,
          materialCoverage: null,
          materialRatePerUnit: null,
          materialRequired: r.expectedMaterialConsumption,
          materialCost: r.materialCost,
          materialCostPerSft:
            r.area !== null && r.area > 0 && r.materialCost !== null
              ? r.materialCost / r.area
              : null,
          clientRate: r.clientRate,
          revenue: r.totalAmount,
          margin: r.projectedProfit,
        })),
      };
    }

    return { projectId, source: 'project-costing' as const, areas: [], rows: [] };
  }

  private formatBoqCostingRow(row: BoqCostingDbRow) {
    return {
      block: row.Block ?? null,
      application: row.Application ?? null,
      layer: row.Layer ?? null,
      area: this.toNullableNumber(row.Area),
      materialName: row['Material Name'] ?? null,
      clientRate: this.toNullableNumber(row['Client Rate']),
      materialCost: this.toNullableNumber(row['Material Cost']),
      totalAmount: this.toNullableNumber(row['Total Amount']),
      expectedMaterialConsumption: this.toNullableNumber(
        row['Expected Material Consumption'],
      ),
      expectedLabourHours: this.toNullableNumber(row['Expected Labour Hours']),
      averageDailyWage: this.toNullableNumber(row['Average Daily Wage']),
      projectedProfit: this.toNullableNumber(row.Projected_Profit),
      currentStock: this.toNullableNumber(row['Current Stock']),
    };
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
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
      return Number.isFinite(parsed) ? parsed : null;
    }

    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
}
