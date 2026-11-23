import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  getDemo() {
    return {
      project: 'Project A',
      totalArea: 100000,
      completedArea: 25000,
      remainingArea: 75000,
      dailyCapacity: 5000,
      daysRemaining: 15,
    };
  }

  async getHomeLayerProgress(projectIdInput: string) {
    const projectId = String(projectIdInput || '').trim();

    if (!projectId) {
      throw new BadRequestException('projectId is required');
    }

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        l.layer_id,
        l.flat_id,
        l.layer_name,
        l.block,
        l.application,
        l.flat,
        l."order" as layer_order,
        l.billable,
        coalesce(l.wkdpct, 0)::numeric as wkdpct,
        l.project_id,
        coalesce(f.total_area_sft, 0)::numeric as total_area,
        (
          coalesce(f.total_area_sft, 0)
          * least(greatest(coalesce(l.wkdpct, 0), 0), 100)
          / 100
        )::numeric as done_area
      from indr.layer l
      left join indr.flat_area_summary f
        on f.project_id = l.project_id
       and upper(trim(coalesce(f.application, ''))) = upper(trim(coalesce(l.application, '')))
       and upper(trim(coalesce(f.flat_id, ''))) = upper(trim(coalesce(l.flat_id, '')))
      where l.project_id = ${projectId}
      order by
        l.application,
        regexp_replace(coalesce(l.flat_id, ''), '\\D', '', 'g'),
        l."order" nulls last,
        l.layer_name
    `;

    return rows.map((row) => ({
      layer_id: row.layer_id,
      flat_id: row.flat_id,
      layer_name: row.layer_name,
      block: row.block,
      application: row.application,
      flat: row.flat,
      order: this.toNumber(row.layer_order),
      layer_order: this.toNumber(row.layer_order),
      billable: row.billable === true,
      wkdpct: this.toNumber(row.wkdpct),
      total_area: this.toNumber(row.total_area),
      done_area: this.toNumber(row.done_area),
      project_id: row.project_id,
    }));
  }

  async getProjectionLayersFromDbCalculation(params: {
    projectId?: string;
    dailyPainters?: string;
    workMode?: string;
  }) {
    const projectId = String(params.projectId || '').trim();

    if (projectId) {
      return this.getProjectProjectionLayers(projectId, params);
    }

    const dailyPainters = this.toSafePositiveNumber(params.dailyPainters, 1);

    const workMode =
      params.workMode && params.workMode.trim() !== ''
        ? params.workMode.trim()
        : null;

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        "LayerID",
        "Block",
        "Application",
        "Flat",
        "LAYERName",
        "ID",
        "Related Backends",
        "Projection Order",
        "Billable Layer Order",
        "Billable",
        "Selected Work Mode",
        "Matched Productivity Mode",
        "Projection Total Area",
        "Projection Done Area",
        "Remaining Area",
        "Work Done Pct",
        "Ideal Sqft/Hr/Labour",
        "Labour Hours Required",
        "Painter Required",
        "Daily Painters Input",
        "Days Required",
        "Material Name",
        "Material Required",
        "Material Cost"
      from public.get_projection_layers_calc(
        cast(${dailyPainters} as numeric),
        cast(${workMode} as text)
      )
      order by
        "Projection Order" nulls last,
        "Flat",
        "LayerID"
    `;

    return rows.map((row) => this.formatProjectionLayerCalcRow(row));
  }

  private async getProjectProjectionLayers(
    projectId: string,
    params: { dailyPainters?: string; workMode?: string },
  ) {
    const dailyPainters = this.toSafePositiveNumber(params.dailyPainters, 1);
    const requestedWorkMode = String(params.workMode || '').trim() || 'Both';

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        c.id,
        c.block,
        c.application,
        c.flat_id,
        c.layer_name,
        c.total_area_sft,
        c.productivity,
        c.material_name,
        c.material_coverage,
        c.material_rate_per_unit,
        l.layer_id,
        l."order" as layer_order,
        l.billable,
        coalesce(l.wkdpct, 0)::numeric as wkdpct
      from indr.project_flat_layer_costing c
      left join lateral (
        select
          x.layer_id,
          x."order",
          x.billable,
          x.wkdpct
        from indr.layer x
        where x.project_id = c.project_id
          and upper(trim(coalesce(x.application, ''))) = upper(trim(coalesce(c.application, '')))
          and upper(trim(coalesce(x.flat_id, ''))) = upper(trim(coalesce(c.flat_id, '')))
          and upper(trim(coalesce(x.layer_name, ''))) = upper(trim(coalesce(c.layer_name, '')))
        order by x."order" nulls last, x.layer_id
        limit 1
      ) l on true
      where c.project_id = ${projectId}
      order by
        c.application,
        regexp_replace(coalesce(c.flat_id, ''), '\\D', '', 'g'),
        l."order" nulls last,
        c.layer_name
    `;

    return rows.map((row) => {
      const totalArea = this.toNumber(row.total_area_sft);
      const workDonePct = Math.min(Math.max(this.toNumber(row.wkdpct), 0), 100);
      const doneArea = (totalArea * workDonePct) / 100;
      const remainingArea = Math.max(totalArea - doneArea, 0);
      const dailyProductivity = this.toNumber(row.productivity);
      const hourlyProductivity = dailyProductivity > 0 ? dailyProductivity / 8 : 0;
      const labourHoursRequired =
        hourlyProductivity > 0 ? remainingArea / hourlyProductivity : 0;
      const painterRequired = labourHoursRequired / 8;
      const daysRequired =
        dailyPainters > 0 ? labourHoursRequired / (dailyPainters * 8) : 0;
      const coverage = this.toNumber(row.material_coverage);
      const materialRate = this.toNumber(row.material_rate_per_unit);
      const materialRequired = coverage > 0 ? remainingArea / coverage : 0;
      const materialCost = materialRequired * materialRate;

      return {
        LayerID: row.layer_id || String(row.id),
        Block: row.block ?? null,
        Application: row.application ?? null,
        Flat: row.flat_id ?? null,
        LAYERName: row.layer_name ?? null,
        ID: String(row.id),
        Related_Backends: null,

        Projection_Order: this.toNumber(row.layer_order) || 999,
        Billable_Layer_Order: this.toNumber(row.layer_order) || 999,
        Projection_Billable: row.billable === true,

        Selected_Work_Mode: requestedWorkMode,
        Matched_Productivity_Mode: requestedWorkMode,

        Projection_Total_Area: totalArea,
        Projection_Done_Area: doneArea,
        Remaining_Area: remainingArea,
        Work_Done_Pct: workDonePct,

        Ideal_Sqft_Hr_Labour: hourlyProductivity,
        Labour_Hours_Required: labourHoursRequired,
        Painter_Required: painterRequired,
        Daily_Painters_Input: dailyPainters,
        Days_Required: daysRequired,

        Material_Name: row.material_name ?? null,
        Material_Required: materialRequired,
        Material_Cost: materialCost,

        Completion_Percent: workDonePct,
        Productivity_Sqft_Per_Hour: hourlyProductivity,
        Painter_Count_Required: painterRequired,
        Projection_Work_Mode: requestedWorkMode,
        Projection_Material_Name: row.material_name ?? null,
        Projection_Material_Coverage: coverage || null,
        Projection_Material_Rate: materialRate,
        Daily_Capacity: dailyProductivity * dailyPainters,
        Layer_Material_Key: null,
      };
    });
  }

  async getFlatCompletionFromDbCalculation(projectIdInput?: string) {
    const projectId = String(projectIdInput || '').trim();

    if (projectId) {
      return this.getProjectFlatCompletion(projectId);
    }

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        "FlatID",
        "ApplicationID",
        "Application",
        "Flat",
        "Billable Layer Count",
        "Completed Billable Layer Count",
        "Billable Total Area",
        "Billable Done Area",
        "Billable Remaining Area",
        "Flat Completion Pct",
        "Flat Master Projection Total Area"
      from public.v_flat_completion_calc
      order by
        "FlatID"
    `;

    return rows.map((row) => this.formatFlatCompletionCalcRow(row));
  }

  private async getProjectFlatCompletion(projectId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      select
        l.flat_id,
        l.application,
        max(l.flat::text) as flat_label,
        count(*) filter (where l.billable = true) as billable_layer_count,
        count(*) filter (
          where l.billable = true
            and coalesce(l.wkdpct, 0) >= 99.995
        ) as completed_billable_layer_count,
        coalesce(sum(f.total_area_sft) filter (where l.billable = true), 0)::numeric
          as billable_total_area,
        coalesce(sum(
          f.total_area_sft
          * least(greatest(coalesce(l.wkdpct, 0), 0), 100)
          / 100
        ) filter (where l.billable = true), 0)::numeric as billable_done_area,
        coalesce(max(f.total_area_sft), 0)::numeric as flat_master_total_area
      from indr.layer l
      left join indr.flat_area_summary f
        on f.project_id = l.project_id
       and upper(trim(coalesce(f.application, ''))) = upper(trim(coalesce(l.application, '')))
       and upper(trim(coalesce(f.flat_id, ''))) = upper(trim(coalesce(l.flat_id, '')))
      where l.project_id = ${projectId}
        and nullif(trim(coalesce(l.flat_id, '')), '') is not null
      group by l.flat_id, l.application
      order by l.application, regexp_replace(coalesce(l.flat_id, ''), '\\D', '', 'g'), l.flat_id
    `;

    return rows.map((row) => {
      const totalArea = this.toNumber(row.billable_total_area);
      const doneArea = this.toNumber(row.billable_done_area);
      const remainingArea = Math.max(totalArea - doneArea, 0);

      return {
        FlatID: row.flat_id,
        ApplicationID: row.application ?? null,
        Application: row.application ?? null,
        Flat: row.flat_label || row.flat_id,
        Billable_Layer_Count: this.toNumber(row.billable_layer_count),
        Completed_Billable_Layer_Count: this.toNumber(
          row.completed_billable_layer_count,
        ),
        Billable_Total_Area: totalArea,
        Billable_Done_Area: doneArea,
        Billable_Remaining_Area: remainingArea,
        Flat_Completion_Pct: totalArea > 0 ? (doneArea / totalArea) * 100 : 0,
        Flat_Master_Projection_Total_Area: this.toNumber(
          row.flat_master_total_area,
        ),
      };
    });
  }

  async getDistinctFlatApplications(projectIdInput?: string): Promise<string[]> {
    const projectId = String(projectIdInput || '').trim();

    if (projectId) {
      const rows = await this.prisma.$queryRaw<
        Array<{ application: string | null }>
      >`
        select distinct application
        from indr.flat_area_summary
        where project_id = ${projectId}
          and nullif(trim(coalesce(application, '')), '') is not null
        order by application
      `;

      return rows
        .map((row) => row.application)
        .filter((value): value is string => Boolean(value));
    }

    const rows = await this.prisma.$queryRaw<{ Application: string | null }[]>`
      select distinct "Application"
      from public.v_flat_completion_calc
      where "Application" is not null
      order by "Application"
    `;

    return rows.map((row) => row.Application).filter((v): v is string => !!v);
  }

  private formatProjectionLayerCalcRow(row: any) {
    return {
      LayerID: row['LayerID'],
      Block: row['Block'],
      Application: row['Application'],
      Flat: row['Flat'],
      LAYERName: row['LAYERName'],
      ID: row['ID'],
      Related_Backends: row['Related Backends'],

      Projection_Order: this.toNumber(row['Projection Order']),
      Billable_Layer_Order: this.toNumber(row['Billable Layer Order']),
      Projection_Billable: row['Billable'],

      Selected_Work_Mode: row['Selected Work Mode'],
      Matched_Productivity_Mode: row['Matched Productivity Mode'],

      Projection_Total_Area: this.toNumber(row['Projection Total Area']),
      Projection_Done_Area: this.toNumber(row['Projection Done Area']),
      Remaining_Area: this.toNumber(row['Remaining Area']),
      Work_Done_Pct: this.toNumber(row['Work Done Pct']),

      Ideal_Sqft_Hr_Labour: this.toNumber(row['Ideal Sqft/Hr/Labour']),
      Labour_Hours_Required: this.toNumber(row['Labour Hours Required']),
      Painter_Required: this.toNumber(row['Painter Required']),
      Daily_Painters_Input: this.toNumber(row['Daily Painters Input']),
      Days_Required: this.toNumber(row['Days Required']),

      Material_Name: row['Material Name'],
      Material_Required: this.toNumber(row['Material Required']),
      Material_Cost: this.toNumber(row['Material Cost']),

      Completion_Percent: this.toNumber(row['Work Done Pct']),
      Productivity_Sqft_Per_Hour: this.toNumber(row['Ideal Sqft/Hr/Labour']),
      Painter_Count_Required: this.toNumber(row['Painter Required']),
      Projection_Work_Mode: row['Selected Work Mode'],
      Projection_Material_Name: row['Material Name'],

      Daily_Capacity: 0,
      Layer_Material_Key: null,
      Projection_Material_Coverage: null,
      Projection_Material_Rate: 0,
    };
  }

  private formatFlatCompletionCalcRow(row: any) {
    return {
      FlatID: row['FlatID'],
      ApplicationID: row['ApplicationID'],
      Application: row['Application'],
      Flat: row['Flat'],

      Billable_Layer_Count: this.toNumber(row['Billable Layer Count']),
      Completed_Billable_Layer_Count: this.toNumber(
        row['Completed Billable Layer Count'],
      ),

      Billable_Total_Area: this.toNumber(row['Billable Total Area']),
      Billable_Done_Area: this.toNumber(row['Billable Done Area']),
      Billable_Remaining_Area: this.toNumber(row['Billable Remaining Area']),

      Flat_Completion_Pct: this.toNumber(row['Flat Completion Pct']),

      Flat_Master_Projection_Total_Area: this.toNumber(
        row['Flat Master Projection Total Area'],
      ),
    };
  }

  private toNumber(value: unknown): number {
    if (value === null || value === undefined || value === '') {
      return 0;
    }

    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'bigint') {
      return Number(value);
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      'toNumber' in value &&
      typeof (value as any).toNumber === 'function'
    ) {
      return (value as any).toNumber();
    }

    return Number(String(value).replace(/,/g, '')) || 0;
  }

  private toSafePositiveNumber(
    value: string | undefined,
    fallback: number,
  ): number {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }
}
