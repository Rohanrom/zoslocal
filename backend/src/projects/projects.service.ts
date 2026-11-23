import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  // Pass a projectId to compute counts for that project only. Without it
  // every project's counts are computed, which is the expensive path.
  async listProjects(onlyProjectId?: string) {
    const projectFilter = onlyProjectId
      ? Prisma.sql`where r.project_id = ${onlyProjectId}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        project_id: string;
        project_name: string;
        project_code: string | null;
        status: string | null;
        created_at: Date;
        layer_count: bigint;
        surface_count: bigint;
        flat_area_count: bigint;
        boq_count: bigint;
        material_count: bigint;
        productivity_count: bigint;
        costing_count: bigint;
        backend_count: bigint;
      }>
    >`
      select
        r.project_id,
        r.project_name,
        pm.project_code,
        pm.status,
        r.created_at,
        (select count(*) from indr.layer l where l.project_id = r.project_id) as layer_count,
        (select count(*) from indr.surface_number s where s.project_id = r.project_id) as surface_count,
        (select count(*) from indr.flat_area_summary f where f.project_id = r.project_id) as flat_area_count,
        (
          select count(*)
          from public.boq b
          where b.project_id = r.project_id
             or (
               r.project_id = 'park_heights'
               and nullif(trim(b.project_id), '') is null
             )
        ) as boq_count,
        (
          select count(*)
          from indr.material_master m
          where m.project_id = r.project_id
            and upper(trim(coalesce(m.status, 'Active'))) = 'ACTIVE'
        ) as material_count,
        (
          select count(*)
          from indr.productivity_master p
          where p.project_id = r.project_id
        ) as productivity_count,
        (
          select count(*)
          from indr.project_flat_layer_costing c
          where c.project_id = r.project_id
        ) as costing_count,
        (
          select count(*)
          from indr.backend b
          where b.project_id = r.project_id
        ) as backend_count
      from public.zos_project_registry r
      left join indr.project_master pm
        on pm.project_id = r.project_id
      ${projectFilter}
      order by r.project_name, r.project_id
    `;

    return rows.map((row) => this.formatProject(row));
  }

  // Dimensions are the existing indr.surface_number records. This API does
  // not modify, recreate, or aggregate any operational database records.
  async getDimensions(
    projectIdInput: string,
    options: {
      page?: string;
      pageSize?: string;
      search?: string;
      block?: string;
      application?: string;
      surfaceType?: string;
    },
  ) {
    const projectId = this.requireProjectId(projectIdInput);
    const requestedPage = Number(options.page || 1);
    const requestedSize = Number(options.pageSize || 50);
    const page = Number.isSafeInteger(requestedPage)
      ? Math.min(Math.max(1, requestedPage), 100000)
      : 1;
    const pageSize = [25, 50, 100].includes(requestedSize) ? requestedSize : 50;
    const offset = (page - 1) * pageSize;

    const search = String(options.search || '').trim().slice(0, 120);
    const block = String(options.block || '').trim().slice(0, 120);
    const application = String(options.application || '').trim().slice(0, 120);
    const surfaceType = String(options.surfaceType || '').trim().slice(0, 120);

    const clauses: Prisma.Sql[] = [Prisma.sql`s.project_id = ${projectId}`];
    if (block) clauses.push(Prisma.sql`trim(coalesce(s.block, '')) = ${block}`);
    if (application) {
      clauses.push(Prisma.sql`trim(coalesce(s.application, '')) = ${application}`);
    }
    if (surfaceType) {
      clauses.push(Prisma.sql`trim(coalesce(s.surface_type, '')) = ${surfaceType}`);
    }
    if (search) {
      const escaped = search.replace(/[!%_]/g, '!$&');
      const pattern = `%${escaped}%`;
      clauses.push(Prisma.sql`(
        coalesce(s.block, '') ILIKE ${pattern} ESCAPE '!'
        OR coalesce(s.application, '') ILIKE ${pattern} ESCAPE '!'
        OR coalesce(s.base, '') ILIKE ${pattern} ESCAPE '!'
        OR coalesce(s.wall, '') ILIKE ${pattern} ESCAPE '!'
        OR coalesce(s.surface_type, '') ILIKE ${pattern} ESCAPE '!'
        OR coalesce(s.surface_id, '') ILIKE ${pattern} ESCAPE '!'
        OR coalesce(s.row_id, '') ILIKE ${pattern} ESCAPE '!'
      )`);
    }
    const where = Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}`;

    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT
          s.surface_id, s.row_id, s.project_id,
          s.block, s.application, s.base, s.wall, s.surface_type,
          s.total_area_sft,
          s."length(+ve)", s."width(+ve)", s."height(+ve)", s.positive_area,
          s."length(-ve)", s."width(-ve)", s."height(-ve)", s.negative_area,
          s."length_2(-ve)", s."width_2(-ve)", s."height_2(-ve)",
          s.created_at, s.updated_at
        FROM indr.surface_number s
        ${where}
        ORDER BY
          s.block NULLS LAST,
          s.application NULLS LAST,
          s.base NULLS LAST,
          s.wall NULLS LAST,
          s.surface_id
        LIMIT ${pageSize} OFFSET ${offset}
      `),
      this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS total
        FROM indr.surface_number s
        ${where}
      `),
    ]);

    const total = Number(totals[0]?.total ?? 0);
    return {
      projectId,
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getDimensionFilters(projectIdInput: string) {
    const projectId = this.requireProjectId(projectIdInput);
    const [blocks, applications, surfaceTypes] = await Promise.all([
      this.prisma.$queryRaw<Array<{ value: string }>>`
        SELECT DISTINCT trim(block) AS value
        FROM indr.surface_number
        WHERE project_id = ${projectId}
          AND nullif(trim(block), '') IS NOT NULL
        ORDER BY value
      `,
      this.prisma.$queryRaw<Array<{ value: string }>>`
        SELECT DISTINCT trim(application) AS value
        FROM indr.surface_number
        WHERE project_id = ${projectId}
          AND nullif(trim(application), '') IS NOT NULL
        ORDER BY value
      `,
      this.prisma.$queryRaw<Array<{ value: string }>>`
        SELECT DISTINCT trim(surface_type) AS value
        FROM indr.surface_number
        WHERE project_id = ${projectId}
          AND nullif(trim(surface_type), '') IS NOT NULL
        ORDER BY value
      `,
    ]);
    return {
      blocks: blocks.map(({ value }) => value),
      applications: applications.map(({ value }) => value),
      surfaceTypes: surfaceTypes.map(({ value }) => value),
    };
  }

  private requireProjectId(projectIdInput: string) {
    const projectId = String(projectIdInput || '').trim();
    if (!projectId || projectId.length > 128) {
      throw new BadRequestException('Valid projectId is required');
    }
    return projectId;
  }

  async getProject(projectIdInput: string) {
    const projectId = this.requireProjectId(projectIdInput);
    const [project] = await this.listProjects(projectId);

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  private formatProject(row: {
    project_id: string;
    project_name: string;
    project_code: string | null;
    status: string | null;
    created_at: Date;
    layer_count: bigint;
    surface_count: bigint;
    flat_area_count: bigint;
    boq_count: bigint;
    material_count: bigint;
    productivity_count: bigint;
    costing_count: bigint;
    backend_count: bigint;
  }) {
    const layerCount = Number(row.layer_count ?? 0);
    const surfaceCount = Number(row.surface_count ?? 0);
    const flatAreaCount = Number(row.flat_area_count ?? 0);
    const boqCount = Number(row.boq_count ?? 0);
    const materialCount = Number(row.material_count ?? 0);
    const productivityCount = Number(row.productivity_count ?? 0);
    const costingCount = Number(row.costing_count ?? 0);
    const backendCount = Number(row.backend_count ?? 0);

    const structureReady = layerCount > 0 && surfaceCount > 0 && flatAreaCount > 0;
    const planningReady = structureReady && (boqCount > 0 || costingCount > 0);

    let setupStatus = 'Setup in progress';
    if (planningReady) setupStatus = 'Planning ready';
    else if (structureReady) setupStatus = 'Structure ready';

    return {
      projectId: row.project_id,
      projectName: row.project_name,
      projectCode:
        row.project_code || row.project_id.replace(/_/g, '-').toUpperCase(),
      status: row.status || 'Active',
      createdAt: row.created_at,
      setupStatus,
      counts: {
        layers: layerCount,
        surfaces: surfaceCount,
        flatAreas: flatAreaCount,
        boq: boqCount,
        materials: materialCount,
        productivity: productivityCount,
        costing: costingCount,
        backend: backendCount,
      },
      capabilities: {
        overview: structureReady,
        projection: costingCount > 0,
        boq: boqCount > 0 || costingCount > 0,
        actualProgress: backendCount > 0,
        assignment: ['park_heights', 'indradhanush'].includes(row.project_id),
        billing: row.project_id === 'indradhanush',
      },
    };
  }
}
