import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  MarkBilledDto,
  RejectBillingDto,
  UpsertFlatAreaDto,
} from './dto/billing-action.dto';

type FloorLayerQuery = {
  layerName?: string;
  floorNo?: string;
  rowType?: string;
  latestOnly?: string;
};

type BillingBatchViewColumnConfig = {
  key: string;
  layerName: string;
  surface: 'Ceiling' | 'Wall';
  batchField: string;
};

const BILLING_BATCH_VIEW_COLUMNS: BillingBatchViewColumnConfig[] = [
  {
    key: 'firstCoarsePuttyCeiling',
    layerName: '1st Coarse Putty',
    surface: 'Ceiling',
    batchField: 'firstCoarsePuttyCeilingBatch',
  },
  {
    key: 'firstCoarsePuttyWall',
    layerName: '1st Coarse Putty',
    surface: 'Wall',
    batchField: 'firstCoarsePuttyWallBatch',
  },
  {
    key: 'secondCoarsePuttyCeiling',
    layerName: '2nd Coarse Putty',
    surface: 'Ceiling',
    batchField: 'secondCoarsePuttyCeilingBatch',
  },
  {
    key: 'secondCoarsePuttyWall',
    layerName: '2nd Coarse Putty',
    surface: 'Wall',
    batchField: 'secondCoarsePuttyWallBatch',
  },
  {
    key: 'firstCoatPrimerCeiling',
    layerName: '1st Coat Primer',
    surface: 'Ceiling',
    batchField: 'firstCoatPrimerCeilingBatch',
  },
  {
    key: 'firstCoatPrimerWall',
    layerName: '1st Coat Primer',
    surface: 'Wall',
    batchField: 'firstCoatPrimerWallBatch',
  },
  {
    key: 'firstCoatPuttyCeiling',
    layerName: '1st Coat Putty',
    surface: 'Ceiling',
    batchField: 'firstCoatPuttyCeilingBatch',
  },
  {
    key: 'firstCoatPuttyWall',
    layerName: '1st Coat Putty',
    surface: 'Wall',
    batchField: 'firstCoatPuttyWallBatch',
  },
  {
    key: 'secondCoatPuttyCeiling',
    layerName: '2nd Coat Putty',
    surface: 'Ceiling',
    batchField: 'secondCoatPuttyCeilingBatch',
  },
  {
    key: 'secondCoatPuttyWall',
    layerName: '2nd Coat Putty',
    surface: 'Wall',
    batchField: 'secondCoatPuttyWallBatch',
  },
  {
    key: 'secondCoatPrimerCeiling',
    layerName: '2nd Coat Primer',
    surface: 'Ceiling',
    batchField: 'secondCoatPrimerCeilingBatch',
  },
  {
    key: 'secondCoatPrimerWall',
    layerName: '2nd Coat Primer',
    surface: 'Wall',
    batchField: 'secondCoatPrimerWallBatch',
  },
  {
    key: 'firstCoatPaintCeiling',
    layerName: '1st Coat Paint',
    surface: 'Ceiling',
    batchField: 'firstCoatPaintCeilingBatch',
  },
  {
    key: 'firstCoatPaintWall',
    layerName: '1st Coat Paint',
    surface: 'Wall',
    batchField: 'firstCoatPaintWallBatch',
  },
  {
    key: 'secondCoatPaintCeiling',
    layerName: '2nd Coat Paint',
    surface: 'Ceiling',
    batchField: 'secondCoatPaintCeilingBatch',
  },
  {
    key: 'secondCoatPaintWall',
    layerName: '2nd Coat Paint',
    surface: 'Wall',
    batchField: 'secondCoatPaintWallBatch',
  },
  {
    key: 'yellowZincPrimerWall',
    layerName: 'Yellow Zinc Primer',
    surface: 'Wall',
    batchField: 'yellowZincPrimerWallBatch',
  },
];

type FloorLayerDetailRow = {
  rowType: string | null;
  sectionTitle: string | null;
  floorLabel: string | null;
  floorNo: number;
  application: string | null;
  flat: string | null;
  description: string | null;
  layerName: string | null;
  layerSort: number;
  unit: string | null;
  nos: number;
  ceilingArea: number;
  ceilingBatch: string | null;
  ceilingBatchNo: number;
  ceilingBillingDate: string | null;
  ceilingBillingNumber: string | null;
  wallArea: number;
  wallBatch: string | null;
  wallBatchNo: number;
  wallBillingDate: string | null;
  wallBillingNumber: string | null;
  batchSummary: string | null;
  latestRowBatchNo: number;
  isLatestBatch: boolean;
  rowHighlight: string | null;
  totalArea: number;
};

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Project-scoped, read-only setup diagnostics for the Billing workspace.
   * A project can open Billing without tracker/batch data; these counts help
   * distinguish unconfigured billing from an empty filtered view.
   */
  async getBillingReadiness(projectId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        tracker_rows: bigint;
        flat_area_rows: bigint;
        batch_rows: bigint;
      }>
    >`
      select
        (select count(*) from billing.billing_tracker_indr
         where project_id = ${projectId}) as tracker_rows,
        (select count(*) from billing.flat_area
         where project_id = ${projectId}) as flat_area_rows,
        (select count(*) from billing.billing_batch_data
         where project_id = ${projectId}) as batch_rows
    `;
    const row = rows[0];
    return {
      projectId,
      trackerRows: Number(row?.tracker_rows ?? 0),
      flatAreaRows: Number(row?.flat_area_rows ?? 0),
      batchRows: Number(row?.batch_rows ?? 0),
    };
  }

  async getOverallBilling(projectId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from billing.billing_tracker_indr
      where project_id = ${projectId}
      order by
        "Application",
        "Flat",
        "Surface Type",
        "Layer Name"
    `;

    return rows.map((row) => this.formatBillingRow(row));
  }

  async getPendingBilling(projectId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from billing.pending_billing
      where project_id = ${projectId}
      order by
        "Application",
        "Flat",
        "Surface Type",
        "Layer Name"
    `;

    return rows.map((row) => this.formatBillingRow(row));
  }

  async getSentForApproval(projectId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from billing.sent_for_approval
      where project_id = ${projectId}
      order by
        "Application",
        "Flat",
        "Surface Type",
        "Layer Name"
    `;

    return rows.map((row) => this.formatBillingRow(row));
  }

  async getAlreadyBilled(projectId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from billing.already_billed
      where project_id = ${projectId}
      order by
        "Batch no." nulls last,
        "Application",
        "Flat",
        "Surface Type",
        "Layer Name"
    `;

    return rows.map((row) => this.formatBillingRow(row));
  }

  async getLatestBilling(projectId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from billing.latest_billing
      where project_id = ${projectId}
      order by
        "Application",
        "Flat",
        "Surface Type",
        "Layer Name"
    `;

    return rows.map((row) => this.formatBillingRow(row));
  }

  async getBillingBatchData(projectId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from billing.billing_batch_data
      where project_id = ${projectId}
      order by "Flat"
    `;

    return rows.map((row) => ({
      flat: row['Flat'],

      firstFinePuttyCeiling: row['1st Fine Putty Ceiling'],
      firstFinePuttyWall: row['1st Fine Putty Wall'],

      secondFinePuttyCeiling: row['2nd Fine Putty Ceiling'],
      secondFinePuttyWall: row['2nd Fine Putty Wall'],

      firstCoatPrimerCeiling: row['1st Coat Primer Ceiling'],
      firstCoatPrimerWall: row['1st Coat Primer Wall'],

      firstCoatPaintCeiling: row['1st Coat Paint Ceiling'],
      firstCoatPaintWall: row['1st Coat Paint Wall'],

      secondCoatPaintCeiling: row['2nd Coat Paint Ceiling'],
      secondCoatPaintWall: row['2nd Coat Paint Wall'],
    }));
  }

  async getBillingBatchView(projectId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      select
        b."Flat" as flat,
        app.application,
        fa."Ceiling Area" as ceiling_area,
        fa."Wall Area" as wall_area,

        b."1st Coarse Putty Ceiling" as "firstCoarsePuttyCeilingBatch",
        b."1st Coarse Putty Wall" as "firstCoarsePuttyWallBatch",

        b."2nd Coarse Putty Ceiling" as "secondCoarsePuttyCeilingBatch",
        b."2nd Coarse Putty Wall" as "secondCoarsePuttyWallBatch",

        b."1st Coat Primer Ceiling" as "firstCoatPrimerCeilingBatch",
        b."1st Coat Primer Wall" as "firstCoatPrimerWallBatch",

        b."1st Coat Putty Ceiling" as "firstCoatPuttyCeilingBatch",
        b."1st Coat Putty Wall" as "firstCoatPuttyWallBatch",

        b."2nd Coat Putty Ceiling" as "secondCoatPuttyCeilingBatch",
        b."2nd Coat Putty Wall" as "secondCoatPuttyWallBatch",

        b."2nd Coat Primer Ceiling" as "secondCoatPrimerCeilingBatch",
        b."2nd Coat Primer Wall" as "secondCoatPrimerWallBatch",

        b."1st Coat Paint Ceiling" as "firstCoatPaintCeilingBatch",
        b."1st Coat Paint Wall" as "firstCoatPaintWallBatch",

        b."2nd Coat Paint Ceiling" as "secondCoatPaintCeilingBatch",
        b."2nd Coat Paint Wall" as "secondCoatPaintWallBatch",

        b."Yellow Zinc Primer Wall" as "yellowZincPrimerWallBatch"

      from billing.billing_batch_data b

      left join billing.flat_area fa
        on fa.project_id = b.project_id
       and trim(coalesce(fa."Flat", '')) = trim(coalesce(b."Flat", ''))

      left join lateral (
        select
          min(nullif(trim(t."Application"), '')) as application
        from billing.billing_tracker_indr t
        where t.project_id = b.project_id
          and trim(coalesce(t."Flat", '')) = trim(coalesce(b."Flat", ''))
      ) app on true

      where b.project_id = ${projectId}
      order by b."Flat"
    `;

    const batches = new Set<string>();
    const applications = new Set<string>();

    const formattedRows = rows.map((row) => {
      const ceilingArea = this.toNumber(row.ceiling_area);
      const wallArea = this.toNumber(row.wall_area);
      const application = this.cleanOptionalString(row.application);

      if (application) {
        applications.add(application);
      }

      const cells = Object.fromEntries(
        BILLING_BATCH_VIEW_COLUMNS.map((column) => {
          const batch = this.cleanOptionalString(row[column.batchField]);

          if (batch) {
            batches.add(batch);
          }

          const sourceArea =
            column.surface === 'Ceiling' ? ceilingArea : wallArea;

          return [
            column.key,
            {
              area: batch ? this.round2(sourceArea) : 0,
              batch,
            },
          ];
        }),
      );

      return {
        flat: String(row.flat ?? ''),
        application,
        cells,
      };
    });

    return {
      columns: BILLING_BATCH_VIEW_COLUMNS.map(
        ({ key, layerName, surface }) => ({
          key,
          layerName,
          surface,
        }),
      ),
      applications: Array.from(applications).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
      batches: Array.from(batches).sort(
        (a, b) => this.getBatchSortValue(a) - this.getBatchSortValue(b),
      ),
      rows: formattedRows,
    };
  }

  async getInvoiceTable(projectId: string, batchNoInput: string) {
    const batchNo = Number(batchNoInput);

    if (!Number.isFinite(batchNo) || batchNo <= 0) {
      throw new BadRequestException(
        'Valid batchNo is required. Example: ?batchNo=4',
      );
    }

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from billing.get_invoice_table(
        ${projectId},
        cast(${batchNo} as integer)
      )
    `;

    return rows.map((row) => ({
      slNo: this.toNumber(row['Sl No']),
      descriptionOfTheWork: row['Description of the work'],
      surface: row['Surface'],
      unit: row['Unit'],
      rate: this.toNumber(row['Rate']),

      quantityPrevious: this.toNumber(row['Quantity Previous']),
      quantityCurrent: this.toNumber(row['Quantity Current']),
      quantityCumulative: this.toNumber(row['Quantity Cumulative']),

      amountPrevious: this.toNumber(row['Amount Previous']),
      amountCurrent: this.toNumber(row['Amount Current']),
      amountCumulative: this.toNumber(row['Amount Cumulative']),
    }));
  }

  async getFlatArea(projectId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      select
        "Flat" as flat,
        "Ceiling Area" as ceiling_area,
        "Wall Area" as wall_area
      from billing.flat_area
      where project_id = ${projectId}
      order by "Flat"
    `;

    return rows.map((row) => ({
      flat: row.flat,
      ceilingArea: Number(row.ceiling_area ?? 0),
      wallArea: Number(row.wall_area ?? 0),
    }));
  }

  async getFloorLayerList(projectId: string) {
    try {
      const rows = await this.prisma.$queryRaw<any[]>`
        select
          layer_name,
          coalesce(min(layer_sort), 999)::int as layer_sort,
          count(*)::int as row_count
        from billing.v_billing_floor_layer_detail
        where project_id = ${projectId}
          and nullif(trim(coalesce(layer_name, '')), '') is not null
        group by layer_name
        order by coalesce(min(layer_sort), 999), layer_name
      `;

      return rows.map((row) => ({
        layerName: String(row.layer_name ?? ''),
        layerSort: Number(row.layer_sort ?? 999),
        rowCount: Number(row.row_count ?? 0),
      }));
    } catch (error) {
      return this.handleFloorLayerError(error, 'getFloorLayerList');
    }
  }

  async getFloorLayerDetail(
    projectId: string,
    query: {
      layerName?: string;
      floorNo?: string;
      rowType?: string;
      latestOnly?: string;
    } = {},
  ) {
    try {
      const rows = await this.prisma.$queryRaw<any[]>`
        select
          row_type,
          section_title,
          floor_label,
          floor_no,
          application,
          flat,
          description,
          layer_name,
          layer_sort,
          unit,
          nos,
          ceiling_area,
          ceiling_batch,
          ceiling_batch_no,
          ceiling_billing_date,
          ceiling_billing_number,
          wall_area,
          wall_batch,
          wall_batch_no,
          wall_billing_date,
          wall_billing_number,
          batch_summary,
          latest_row_batch_no,
          is_latest_batch,
          row_highlight,
          total_area
        from billing.v_billing_floor_layer_detail
        where project_id = ${projectId}
        order by
          floor_no nulls last,
          layer_sort nulls last,
          case
            when description ~ '^[0-9]+$' then description::integer
            else null
          end nulls last,
          description,
          layer_name
      `;

      const expectedLayerName = String(query.layerName ?? '').trim();
      const expectedRowType = String(query.rowType ?? '').trim().toUpperCase();
      const expectedFloorNo = Number(query.floorNo);
      const latestOnly = ['true', '1', 'yes', 'y'].includes(
        String(query.latestOnly ?? '').trim().toLowerCase(),
      );

      return rows
        .map((row) => this.formatFloorLayerDetailRow(row))
        .filter((row) => {
          if (expectedLayerName && row.layerName !== expectedLayerName) {
            return false;
          }

          if (expectedRowType && row.rowType !== expectedRowType) {
            return false;
          }

          if (Number.isFinite(expectedFloorNo) && expectedFloorNo > 0) {
            if (row.floorNo !== expectedFloorNo) {
              return false;
            }
          }

          if (latestOnly && !row.isLatestBatch) {
            return false;
          }

          return true;
        });
    } catch (error) {
      return this.handleFloorLayerError(error, 'getFloorLayerDetail');
    }
  }

  async getFloorLayerLatest(projectId: string) {
    try {
      const rows = await this.prisma.$queryRaw<any[]>`
        select
          row_type,
          section_title,
          floor_label,
          floor_no,
          application,
          flat,
          description,
          layer_name,
          layer_sort,
          unit,
          nos,
          ceiling_area,
          ceiling_batch,
          ceiling_batch_no,
          ceiling_billing_date,
          ceiling_billing_number,
          wall_area,
          wall_batch,
          wall_batch_no,
          wall_billing_date,
          wall_billing_number,
          batch_summary,
          latest_row_batch_no,
          is_latest_batch,
          row_highlight,
          total_area
        from billing.v_billing_floor_layer_latest
        where project_id = ${projectId}
        order by
          floor_no nulls last,
          layer_sort nulls last,
          description,
          layer_name
      `;

      return rows.map((row) => this.formatFloorLayerDetailRow(row));
    } catch (error) {
      return this.handleFloorLayerError(error, 'getFloorLayerLatest');
    }
  }

  async getFloorLayerTotals(
    projectId: string,
    query: {
      layerName?: string;
      floorNo?: string;
      rowType?: string;
    } = {},
  ) {
    try {
      const rows = await this.prisma.$queryRaw<any[]>`
        select
          row_type,
          section_title,
          floor_label,
          floor_no,
          layer_name,
          unit,
          total_ceiling_area,
          total_wall_area,
          total_area,
          latest_batch_no,
          has_latest_batch_rows,
          included_descriptions
        from billing.v_billing_floor_layer_totals
        where project_id = ${projectId}
        order by
          floor_no nulls last,
          layer_name,
          row_type,
          section_title
      `;

      const expectedLayerName = String(query.layerName ?? '').trim();
      const expectedRowType = String(query.rowType ?? '').trim().toUpperCase();
      const expectedFloorNo = Number(query.floorNo);

      return rows
        .map((row) => ({
          rowType: row.row_type ?? null,
          sectionTitle: row.section_title ?? null,
          floorLabel: row.floor_label ?? null,
          floorNo: Number(row.floor_no ?? 0),
          layerName: row.layer_name ?? null,
          unit: row.unit ?? null,
          totalCeilingArea: Number(row.total_ceiling_area ?? 0),
          totalWallArea: Number(row.total_wall_area ?? 0),
          totalArea: Number(row.total_area ?? 0),
          latestBatchNo: Number(row.latest_batch_no ?? 0),
          hasLatestBatchRows: Boolean(row.has_latest_batch_rows),
          includedDescriptions: row.included_descriptions ?? null,
        }))
        .filter((row) => {
          if (expectedLayerName && row.layerName !== expectedLayerName) {
            return false;
          }

          if (expectedRowType && row.rowType !== expectedRowType) {
            return false;
          }

          if (Number.isFinite(expectedFloorNo) && expectedFloorNo > 0) {
            if (row.floorNo !== expectedFloorNo) {
              return false;
            }
          }

          return true;
        });
    } catch (error) {
      return this.handleFloorLayerError(error, 'getFloorLayerTotals');
    }
  }

  async getFloorLayerReport(projectId: string, layerName?: string) {
    try {
      const rows = await this.getFloorLayerDetail(projectId, {
        layerName,
      });

      const sectionMap = new Map<
      string,
      {
        sectionTitle: string;
        rowType: string | null;
        floorNo: number;
        floorLabel: string | null;
        layerName: string | null;
        unit: string | null;
        hasLatestBatchRows: boolean;
        rows: any[];
        totals: {
          ceilingArea: number;
          wallArea: number;
          totalArea: number;
        };
      }
    >();

      for (const row of rows) {
        const sectionKey = [
          row.rowType ?? '',
          row.floorNo ?? '',
          row.layerName ?? '',
          row.sectionTitle ?? '',
        ].join('|');

        if (!sectionMap.has(sectionKey)) {
          sectionMap.set(sectionKey, {
            sectionTitle: row.sectionTitle || 'Billing Section',
            rowType: row.rowType,
            floorNo: row.floorNo,
            floorLabel: row.floorLabel,
            layerName: row.layerName,
            unit: row.unit,
            hasLatestBatchRows: false,
            rows: [],
            totals: {
              ceilingArea: 0,
              wallArea: 0,
              totalArea: 0,
            },
          });
        }

        const section = sectionMap.get(sectionKey)!;

        section.rows.push(row);
        section.hasLatestBatchRows =
          section.hasLatestBatchRows || row.isLatestBatch;

        section.totals.ceilingArea += Number(row.ceilingArea ?? 0);
        section.totals.wallArea += Number(row.wallArea ?? 0);
        section.totals.totalArea += Number(row.totalArea ?? 0);
      }

      const sections = Array.from(sectionMap.values()).map((section) => ({
        ...section,
        totals: {
          ceilingArea: this.round2(section.totals.ceilingArea),
          wallArea: this.round2(section.totals.wallArea),
          totalArea: this.round2(section.totals.totalArea),
        },
      }));

      sections.sort((a, b) => {
        if (a.floorNo !== b.floorNo) {
          return Number(a.floorNo ?? 0) - Number(b.floorNo ?? 0);
        }

        return String(a.sectionTitle ?? '').localeCompare(
          String(b.sectionTitle ?? ''),
        );
      });

      return {
        layerName: String(layerName ?? '').trim() || null,
        sectionCount: sections.length,
        rowCount: rows.length,
        sections,
      };
    } catch (error) {
      return this.handleFloorLayerError(error, 'getFloorLayerReport');
    }
  }

  private formatFloorLayerDetailRow(row: any) {
    return {
      rowType: row.row_type ?? null,
      sectionTitle: row.section_title ?? null,
      floorLabel: row.floor_label ?? null,
      floorNo: Number(row.floor_no ?? 0),
      application: row.application ?? null,
      flat: row.flat ?? null,
      description: row.description ?? null,
      layerName: row.layer_name ?? null,
      layerSort: Number(row.layer_sort ?? 999),
      unit: row.unit ?? null,
      nos: Number(row.nos ?? 0),

      ceilingArea: Number(row.ceiling_area ?? 0),
      ceilingBatch: row.ceiling_batch ?? null,
      ceilingBatchNo: Number(row.ceiling_batch_no ?? 0),
      ceilingBillingDate: row.ceiling_billing_date
        ? String(row.ceiling_billing_date)
        : null,
      ceilingBillingNumber: row.ceiling_billing_number ?? null,

      wallArea: Number(row.wall_area ?? 0),
      wallBatch: row.wall_batch ?? null,
      wallBatchNo: Number(row.wall_batch_no ?? 0),
      wallBillingDate: row.wall_billing_date
        ? String(row.wall_billing_date)
        : null,
      wallBillingNumber: row.wall_billing_number ?? null,

      batchSummary: row.batch_summary ?? null,
      latestRowBatchNo: Number(row.latest_row_batch_no ?? 0),
      isLatestBatch: Boolean(row.is_latest_batch),
      rowHighlight: row.row_highlight ?? null,
      totalArea: Number(row.total_area ?? 0),
    };
  }

  private round2(value: number) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  private handleFloorLayerError(error: unknown, source: string): never {
    console.error(`[Billing Floor Layer Error] ${source}`, error);

    const message =
      error instanceof Error
        ? error.message
        : 'Floor wise billing query failed';

    throw new InternalServerErrorException(message);
  }

  async sendForApproval(projectId: string, id: string) {
    await this.ensureBillingRowExists(projectId, id);

    await this.prisma.$executeRaw`
      update billing.billing_tracker_indr
      set
        "Status" = 'Sent'
      where project_id = ${projectId}
        and "id" = ${id}
        and coalesce("Billed", false) = false
    `;

    await this.refreshBillingBatchData(projectId);

    return this.getBillingRowById(projectId, id);
  }

  async approveBilling(projectId: string, id: string) {
    await this.ensureBillingRowExists(projectId, id);

    await this.prisma.$executeRaw`
      update billing.billing_tracker_indr
      set
        "Status" = 'Approved'
      where project_id = ${projectId}
        and "id" = ${id}
        and coalesce("Billed", false) = false
    `;

    await this.refreshBillingBatchData(projectId);

    return this.getBillingRowById(projectId, id);
  }

  async rejectBilling(projectId: string, id: string, _dto: RejectBillingDto) {
    await this.ensureBillingRowExists(projectId, id);

    await this.prisma.$executeRaw`
      update billing.billing_tracker_indr
      set
        "Status" = 'Rejected'
      where project_id = ${projectId}
        and "id" = ${id}
        and coalesce("Billed", false) = false
    `;

    await this.refreshBillingBatchData(projectId);

    return this.getBillingRowById(projectId, id);
  }

  async markAsBilled(projectId: string, id: string, dto: MarkBilledDto) {
    await this.ensureBillingRowExists(projectId, id);

    const batchNo = dto.batchNo ?? (await this.getNextBatchNo(projectId));
    const billingDate = dto.billingDate ?? this.getTodayIsoDate();
    const batchLabel = `B${batchNo}`;

    /*
      Note:
      Screenshot shows Status = Approved even after Billed = Y.
      So this keeps Status as Approved.
      If later you want Status = Billed, change 'Approved' to 'Billed' below.
    */

    await this.prisma.$executeRaw`
      update billing.billing_tracker_indr
      set
        "Billed" = true,
        "Status" = 'Approved',
        "Billing Date" = cast(${billingDate} as date),
        "Batch no." = cast(${batchNo} as integer),
        "Batch" = ${batchLabel},
        "Can Billed" = false,
        "Billing Number" = coalesce(
          nullif("Billing Number", ''),
          'INV-' || to_char(cast(${billingDate} as date), 'YYMMDD') || '-' || substring(md5("id"), 1, 4)
        )
      where project_id = ${projectId}
        and "id" = ${id}
    `;

    await this.refreshBillingBatchData(projectId);

    return this.getBillingRowById(projectId, id);
  }

  async refreshBillingBatchData(_projectId?: string) {
    await this.prisma.$executeRaw`
      select billing.refresh_billing_batch_data_core()
    `;

    return {
      success: true,
      message: 'Billing batch data refreshed successfully',
    };
  }

  async upsertFlatArea(projectId: string, flat: string, dto: UpsertFlatAreaDto) {
    const ceilingArea = this.toNumber(dto.ceilingArea);
    const wallArea = this.toNumber(dto.wallArea);

    await this.prisma.$executeRaw`
      insert into billing.flat_area (
        project_id,
        "Flat",
        "Ceiling Area",
        "Wall Area"
      )
      values (
        ${projectId},
        ${flat},
        cast(${ceilingArea} as numeric),
        cast(${wallArea} as numeric)
      )
      on conflict (project_id, "Flat") do update
      set
        "Ceiling Area" = excluded."Ceiling Area",
        "Wall Area" = excluded."Wall Area"
    `;

    await this.refreshBillingBatchData(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from billing.flat_area
      where project_id = ${projectId}
        and "Flat" = ${flat}
      limit 1
    `;

    const row = rows[0];

    return {
      flat: row['Flat'],
      ceilingArea: this.toNumber(row['Ceiling Area']),
      wallArea: this.toNumber(row['Wall Area']),
    };
  }

  private async getBillingRowById(projectId: string, id: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from billing.billing_tracker_indr
      where project_id = ${projectId}
        and "id" = ${id}
      limit 1
    `;

    if (!rows[0]) {
      throw new NotFoundException('Billing row not found');
    }

    return this.formatBillingRow(rows[0]);
  }

  private async ensureBillingRowExists(projectId: string, id: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      select "id"
      from billing.billing_tracker_indr
      where project_id = ${projectId}
        and "id" = ${id}
      limit 1
    `;

    if (!rows[0]) {
      throw new NotFoundException('Billing row not found');
    }
  }

  private async getNextBatchNo(projectId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      select
        coalesce(
          max(billing.get_tracker_batch_no("Batch no.", "Batch")),
          0
        ) + 1 as next_batch_no
      from billing.billing_tracker_indr
      where project_id = ${projectId}
    `;

    return this.toNumber(rows[0]?.next_batch_no || rows[0]?.next_batchNo || 1);
  }

  private formatBillingRow(row: any) {
    return {
      id: row['id'],

      application: row['Application'],
      flat: row['Flat'],
      surfaceType: row['Surface Type'],
      layerName: row['Layer Name'],

      billed: Boolean(row['Billed']),
      billingNumber: row['Billing Number'],
      billingDate: this.formatDate(row['Billing Date']),

      rate: this.toNumber(row['Rate']),
      billingArea: this.toNumber(row['Billing Area']),

      status: row['Status'],
      batchNo: this.toNumber(row['Batch no.']),
      workDonePct: this.toNumber(row['WorkDonePct']),

      isComplete: Boolean(row['Is Complete']),
      canBilled: Boolean(row['Can Billed']),

      batch: row['Batch'],
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

  private formatDate(value: unknown): string | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    return String(value).slice(0, 10);
  }

  private getBatchSortValue(value: string) {
    const match = String(value ?? '').match(/\d+/);
    return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
  }

  private getTodayIsoDate() {
    return new Date().toISOString().slice(0, 10);
  }

  private async getRawFloorLayerDetail(projectId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from billing.v_billing_floor_layer_detail
      where project_id = ${projectId}
      order by
        floor_no nulls last,
        layer_sort nulls last,
        case
          when description ~ '^[0-9]+$' then description::integer
          else null
        end nulls last,
        description,
        layer_name
    `;

    return rows.map((row) => this.formatFloorLayerDetailRow(row));
  }

  private matchesFloorLayerQuery(
    row: FloorLayerDetailRow,
    query: FloorLayerQuery,
  ) {
    const layerName = this.cleanOptionalString(query.layerName);
    const rowType = this.cleanOptionalString(query.rowType)?.toUpperCase();
    const floorNo = this.parseOptionalPositiveNumber(query.floorNo);
    const latestOnly = this.parseBoolean(query.latestOnly);

    if (layerName && row.layerName !== layerName) {
      return false;
    }

    if (rowType && row.rowType !== rowType) {
      return false;
    }

    if (floorNo && row.floorNo !== floorNo) {
      return false;
    }

    if (latestOnly && !row.isLatestBatch) {
      return false;
    }

    return true;
  }

  private sortFloorLayerRows(
    a: FloorLayerDetailRow,
    b: FloorLayerDetailRow,
  ) {
    if (a.floorNo !== b.floorNo) {
      return a.floorNo - b.floorNo;
    }

    if (a.layerSort !== b.layerSort) {
      return a.layerSort - b.layerSort;
    }

    const aNumeric = this.parseOptionalPositiveNumber(a.description || '');
    const bNumeric = this.parseOptionalPositiveNumber(b.description || '');

    if (aNumeric && bNumeric && aNumeric !== bNumeric) {
      return aNumeric - bNumeric;
    }

    return (a.description || '').localeCompare(b.description || '');
  }

  private cleanOptionalString(value?: string | null) {
    const cleaned = String(value ?? '').trim();
    return cleaned || null;
  }

  private parseOptionalPositiveNumber(value?: string | null) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    return parsed;
  }

  private parseBoolean(value?: string | null) {
    return ['true', '1', 'yes', 'y'].includes(
      String(value ?? '').trim().toLowerCase(),
    );
  }

}