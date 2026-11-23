import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type ClientLayerStatusDbRow = {
  project_id: string | null;
  layer_id: string | null;
  flat_id: string | null;
  block: string | null;
  application: string | null;
  flat: string | number | null;
  layer_name: string | null;
  layer_order: unknown;
  billable: boolean | null;
  total_area: unknown;
  done_area: unknown;
  wkdpct: unknown;
};

type ClientOverviewRow = {
  projectId: string | null;
  layerId: string | null;
  flatId: string | null;
  block: string | null;
  application: string | null;
  flat: string | number | null;
  layerName: string | null;
  layerOrder: number;
  billable: boolean;
  totalArea: number;
  doneArea: number;
  wkdpct: number;
};

type ClientBoqDbRow = {
  Block: string | null;
  Application: string | null;
  Layer: string | null;
  Area: unknown;
  'Client Rate': unknown;
};

type ClientBoqRow = {
  block: string | null;
  application: string | null;
  layer: string | null;
  area: number | null;
  clientRate: number | null;
};

type WorkApprovalOptionDbRow = {
  block: string | null;
  application: string | null;
  flat: string | null;
};

type WorkApprovalOption = {
  block: string;
  application: string;
  floor: string;
  flat: string;
};

type WorkApprovalDbRow = {
  block: string;
  application: string;
  floor: string;
  flat: string;
  approval_source: 'flat' | 'floor';
  approved_by_username: string;
  approved_at: Date;
};

type WorkApprovalRecord = {
  block: string;
  application: string;
  floor: string;
  flat: string;
  source: 'flat' | 'floor';
  approvedBy: string;
  approvedAt: Date;
};

type WorkApprovalSubmission = {
  block: string;
  application: string;
  flat: string;
  source: 'flat' | 'floor';
};

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

@Injectable()
export class ClientService {
  private readonly allowedProjectIds = new Set([
    'park_heights',
    'indradhanush',
  ]);

  /*
   * Client pages are read-only.
   *
   * A very small cache is safe here and prevents:
   * - React duplicate requests
   * - repeated tab switching
   * - multiple client requests hitting the same heavy view together
   *
   * Overview remains fresh within 15 seconds.
   * BOQ is effectively static, so 5 minutes is fine.
   */
  private readonly overviewCache = new Map<
    string,
    CacheEntry<ClientOverviewRow[]>
  >();

  private readonly boqCache = new Map<
    string,
    CacheEntry<ClientBoqRow[]>
  >();

  // Flat/application hierarchy changes rarely, so only this lightweight
  // option list is cached. Approval state itself is always read fresh.
  private readonly workApprovalOptionsCache = new Map<
    string,
    CacheEntry<WorkApprovalOption[]>
  >();

  /*
   * Also deduplicate simultaneous requests.
   *
   * If the browser accidentally sends /client/overview twice,
   * PostgreSQL will execute the heavy query only once.
   */
  private readonly overviewInFlight = new Map<
    string,
    Promise<ClientOverviewRow[]>
  >();

  private readonly boqInFlight = new Map<
    string,
    Promise<ClientBoqRow[]>
  >();

  private readonly workApprovalOptionsInFlight = new Map<
    string,
    Promise<WorkApprovalOption[]>
  >();

  private readonly OVERVIEW_CACHE_MS = 15_000;
  private readonly BOQ_CACHE_MS = 5 * 60 * 1000;
  private readonly WORK_APPROVAL_OPTIONS_CACHE_MS = 10 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------
  // CLIENT OVERVIEW
  // -------------------------------------------------------

  async getOverview(projectId: string): Promise<ClientOverviewRow[]> {
    this.assertClientProject(projectId);

    const now = Date.now();

    const cached = this.overviewCache.get(projectId);

    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    /*
     * If another request for the same project is already executing,
     * reuse that Promise instead of running the DB query again.
     */
    const existingRequest = this.overviewInFlight.get(projectId);

    if (existingRequest) {
      return existingRequest;
    }

    const request = this.loadOverview(projectId);

    this.overviewInFlight.set(projectId, request);

    try {
      const data = await request;

      this.overviewCache.set(projectId, {
        data,
        expiresAt: Date.now() + this.OVERVIEW_CACHE_MS,
      });

      return data;
    } finally {
      this.overviewInFlight.delete(projectId);
    }
  }

  private async loadOverview(
    projectId: string,
  ): Promise<ClientOverviewRow[]> {
    /*
     * IMPORTANT:
     *
     * Do NOT ORDER BY regexp_replace() inside PostgreSQL.
     *
     * We need all rows anyway and JS can sort 15k rows extremely quickly.
     * This removes unnecessary database CPU work.
     */
    const rows =
      await this.prisma.$queryRaw<ClientLayerStatusDbRow[]>`
        select
          project_id,
          layer_id,
          flat::text as flat_id,
          block,
          application,
          flat,
          layer_name,
          layer_order,
          billable,
          total_area,
          done_area,
          wkdpct
        from indr.assignment_v_layer_status
        where project_id = ${projectId}
      `;

    const mapped: ClientOverviewRow[] = rows.map((row) => ({
      projectId: row.project_id,
      layerId: row.layer_id,
      flatId: row.flat_id,
      block: row.block,
      application: row.application,
      flat: row.flat,
      layerName: row.layer_name,
      layerOrder: this.toNumber(row.layer_order),
      billable: row.billable === true,
      totalArea: this.toNumber(row.total_area),
      doneArea: this.toNumber(row.done_area),
      wkdpct: this.toNumber(row.wkdpct),
    }));

    /*
     * Sort in Node instead of PostgreSQL.
     */
    mapped.sort((a, b) => {
      const applicationCompare = String(a.application ?? '').localeCompare(
        String(b.application ?? ''),
        undefined,
        {
          numeric: true,
          sensitivity: 'base',
        },
      );

      if (applicationCompare !== 0) {
        return applicationCompare;
      }

      const flatCompare = String(a.flat ?? '').localeCompare(
        String(b.flat ?? ''),
        undefined,
        {
          numeric: true,
          sensitivity: 'base',
        },
      );

      if (flatCompare !== 0) {
        return flatCompare;
      }

      if (a.layerOrder !== b.layerOrder) {
        return a.layerOrder - b.layerOrder;
      }

      return String(a.layerName ?? '').localeCompare(
        String(b.layerName ?? ''),
        undefined,
        {
          numeric: true,
          sensitivity: 'base',
        },
      );
    });

    return mapped;
  }

  // -------------------------------------------------------
  // CLIENT BOQ
  // -------------------------------------------------------

  async getBoq(projectId: string): Promise<ClientBoqRow[]> {
    this.assertClientProject(projectId);

    /*
     * Current public.boq belongs to Park Heights.
     * Do not expose APH data to another project.
     */
    if (projectId !== 'park_heights') {
      return [];
    }

    const now = Date.now();

    const cached = this.boqCache.get(projectId);

    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const existingRequest = this.boqInFlight.get(projectId);

    if (existingRequest) {
      return existingRequest;
    }

    const request = this.loadBoq();

    this.boqInFlight.set(projectId, request);

    try {
      const data = await request;

      this.boqCache.set(projectId, {
        data,
        expiresAt: Date.now() + this.BOQ_CACHE_MS,
      });

      return data;
    } finally {
      this.boqInFlight.delete(projectId);
    }
  }

  private async loadBoq(): Promise<ClientBoqRow[]> {
    /*
     * CLIENT DOES NOT NEED boq_costing.
     *
     * public.boq_costing performs calculations/joins for:
     * material cost, labour cost, profitability, etc.
     *
     * Client only needs the raw BOQ fields below.
     *
     * Read public.boq directly.
     */
    const rows = await this.prisma.$queryRaw<ClientBoqDbRow[]>`
      select distinct
        block as "Block",
        "Application",
        "Layer",
        "Area",
        "Client Rate"
      from public.boq
      where coalesce(trim("Application"), '') <> ''
        and coalesce(trim("Layer"), '') <> ''
      order by
        block asc nulls last,
        "Application" asc nulls last,
        "Layer" asc nulls last
    `;

    return rows.map((row) => ({
      block: row.Block,
      application: row.Application,
      layer: row.Layer,
      area: this.toNullableNumber(row.Area),
      clientRate: this.toNullableNumber(row['Client Rate']),
    }));
  }

  // -------------------------------------------------------
  // CLIENT WORK APPROVAL
  // -------------------------------------------------------

  async getWorkApproval(projectId: string) {
    this.assertClientProject(projectId);

    const [options, approvals] = await Promise.all([
      this.getWorkApprovalOptions(projectId),
      this.loadWorkApprovals(projectId),
    ]);

    return {
      options,
      approvals,
    };
  }

  async submitWorkApproval(
    projectId: string,
    userId: string,
    username: string,
    submissions: WorkApprovalSubmission[],
  ) {
    this.assertClientProject(projectId);

    if (!Array.isArray(submissions) || submissions.length === 0) {
      throw new BadRequestException('Select at least one flat to approve');
    }

    if (submissions.length > 1000) {
      throw new BadRequestException('Too many flats selected in one approval');
    }

    if (!/^\d+$/.test(String(userId || ''))) {
      throw new BadRequestException('Authenticated client user is invalid');
    }

    const options = await this.getWorkApprovalOptions(projectId);
    const optionMap = new Map(
      options.map((option) => [this.workApprovalKey(option), option]),
    );

    const validRows = new Map<
      string,
      WorkApprovalOption & { source: 'flat' | 'floor' }
    >();

    for (const submission of submissions) {
      const source = submission?.source;

      if (source !== 'flat' && source !== 'floor') {
        throw new BadRequestException('Invalid approval source');
      }

      const requested = {
        block: String(submission?.block || '').trim(),
        application: String(submission?.application || '').trim(),
        flat: String(submission?.flat || '').trim(),
      };

      const option = optionMap.get(this.workApprovalKey(requested));

      if (!option) {
        throw new BadRequestException(
          `Flat ${requested.flat || '(blank)'} is not valid for the selected project/application`,
        );
      }

      validRows.set(this.workApprovalKey(option), {
        ...option,
        source,
      });
    }

    const payload = JSON.stringify(Array.from(validRows.values()));

    await this.prisma.$executeRaw`
      insert into indr.client_work_approval (
        project_id,
        block,
        application,
        floor,
        flat,
        approval_source,
        approved_by_user_id,
        approved_by_username
      )
      select
        ${projectId},
        submitted.block,
        submitted.application,
        submitted.floor,
        submitted.flat,
        submitted.source,
        ${userId}::bigint,
        ${username}
      from jsonb_to_recordset(${payload}::jsonb) as submitted(
        block text,
        application text,
        floor text,
        flat text,
        source text
      )
      on conflict (project_id, block, application, flat) do nothing
    `;

    const state = await this.getWorkApproval(projectId);

    return {
      message: 'Work approval submitted successfully',
      ...state,
    };
  }

  private async getWorkApprovalOptions(
    projectId: string,
  ): Promise<WorkApprovalOption[]> {
    const now = Date.now();
    const cached = this.workApprovalOptionsCache.get(projectId);

    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const pending = this.workApprovalOptionsInFlight.get(projectId);

    if (pending) {
      return pending;
    }

    const request = this.loadWorkApprovalOptions(projectId);
    this.workApprovalOptionsInFlight.set(projectId, request);

    try {
      const data = await request;

      this.workApprovalOptionsCache.set(projectId, {
        data,
        expiresAt: Date.now() + this.WORK_APPROVAL_OPTIONS_CACHE_MS,
      });

      return data;
    } finally {
      this.workApprovalOptionsInFlight.delete(projectId);
    }
  }

  private async loadWorkApprovalOptions(
    projectId: string,
  ): Promise<WorkApprovalOption[]> {
    // This intentionally reads the lightweight layer master, not the heavy
    // progress view. Only distinct Block/Application/Flat values are needed.
    const rows = await this.prisma.$queryRaw<WorkApprovalOptionDbRow[]>`
      select distinct
        trim(block) as block,
        trim(application) as application,
        coalesce(
          nullif(trim(flat_id), ''),
          nullif(trim(flat), '')
        ) as flat
      from indr.layer
      where project_id = ${projectId}
        and coalesce(trim(block), '') <> ''
        and coalesce(trim(application), '') <> ''
        and coalesce(
          nullif(trim(flat_id), ''),
          nullif(trim(flat), '')
        ) is not null
    `;

    return rows
      .filter(
        (row) =>
          Boolean(row.block) &&
          Boolean(row.application) &&
          Boolean(row.flat),
      )
      .map((row) => ({
        block: String(row.block).trim(),
        application: String(row.application).trim(),
        flat: String(row.flat).trim(),
        floor: this.getFloorCode(String(row.flat)),
      }))
      .sort((a, b) => {
        const blockCompare = a.block.localeCompare(b.block, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        if (blockCompare !== 0) return blockCompare;

        const applicationCompare = a.application.localeCompare(
          b.application,
          undefined,
          { numeric: true, sensitivity: 'base' },
        );
        if (applicationCompare !== 0) return applicationCompare;

        return a.flat.localeCompare(b.flat, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      });
  }

  private async loadWorkApprovals(
    projectId: string,
  ): Promise<WorkApprovalRecord[]> {
    const rows = await this.prisma.$queryRaw<WorkApprovalDbRow[]>`
      select
        block,
        application,
        floor,
        flat,
        approval_source,
        approved_by_username,
        approved_at
      from indr.client_work_approval
      where project_id = ${projectId}
      order by block, application, floor, flat
    `;

    return rows.map((row) => ({
      block: row.block,
      application: row.application,
      floor: row.floor,
      flat: row.flat,
      source: row.approval_source,
      approvedBy: row.approved_by_username,
      approvedAt: row.approved_at,
    }));
  }

  private getFloorCode(flatValue: string): string {
    const raw = String(flatValue || '').trim();
    const lastSegment = raw.split('-').filter(Boolean).pop() || raw;
    const digits = lastSegment.replace(/\D/g, '');

    if (!digits) {
      return 'UNKNOWN';
    }

    if (digits.length <= 2) {
      return digits.padStart(2, '0');
    }

    return digits.slice(0, -2).padStart(2, '0');
  }

  private workApprovalKey(value: {
    block: string;
    application: string;
    flat: string;
  }): string {
    return [value.block, value.application, value.flat]
      .map((part) => String(part || '').trim().toLowerCase())
      .join('||');
  }

  // -------------------------------------------------------
  // VALIDATION
  // -------------------------------------------------------

  private assertClientProject(projectId: string) {
    if (!projectId || !this.allowedProjectIds.has(projectId)) {
      throw new ForbiddenException(
        'Client project assignment is invalid',
      );
    }
  }

  // -------------------------------------------------------
  // NUMBER HELPERS
  // -------------------------------------------------------

  private toNumber(value: unknown): number {
    return this.toNullableNumber(value) ?? 0;
  }

  private toNullableNumber(value: unknown): number | null {
    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
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
      typeof (value as { toNumber?: unknown }).toNumber ===
        'function'
    ) {
      const parsed = (
        value as {
          toNumber: () => number;
        }
      ).toNumber();

      return Number.isFinite(parsed) ? parsed : null;
    }

    const parsed = Number(
      String(value).replace(/,/g, ''),
    );

    return Number.isFinite(parsed) ? parsed : null;
  }
}