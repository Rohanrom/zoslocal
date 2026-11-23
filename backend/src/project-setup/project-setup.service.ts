import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  RequestTimeoutException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';

type JsonRow = Record<string, unknown>;

type LayerImportRow = {
  layerId: string;
  flatId: string;
  layerName: string;
  block: string;
  application: string;
  flat: string;
  order: number;
  billable: boolean;
};

type SurfaceImportRow = {
  block: string;
  application: string;
  base: string;
  wall: string;
  surfaceType: 'ceiling' | 'wall';
  totalAreaSft: number;
  lengthPositive: number | null;
  widthPositive: number | null;
  heightPositive: number | null;
  positiveArea: number | null;
  lengthNegative: number | null;
  widthNegative: number | null;
  heightNegative: number | null;
  negativeArea: number | null;
  length2Negative: number | null;
  width2Negative: number | null;
  height2Negative: number | null;
};

type CostBoqImportRow = {
  application: string;
  layerName: string;
  productivity: number | null;
  perLabourCost: number | null;
  materialName: string | null;
  materialCoverage: number | null;
  materialRatePerUnit: number | null;
  clientRate: number | null;
};

@Injectable()
export class ProjectSetupService {
  private readonly logger = new Logger(ProjectSetupService.name);

  constructor(private readonly prisma: PrismaService) {}

  private cleanText(value: unknown) {
    return String(value ?? '').trim();
  }

  private normalizeProjectId(value: unknown) {
    const projectId = this.cleanText(value).toLowerCase();
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(projectId)) {
      throw new BadRequestException(
        'Invalid project_id. Use lowercase letters, numbers and underscores only.',
      );
    }
    return projectId;
  }

  private parseUploadedRows(file: any): JsonRow[] {
    if (!file?.buffer) {
      throw new BadRequestException('Import file is required');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(file.buffer.toString('utf8'));
    } catch {
      throw new BadRequestException(
        'The uploaded import payload is invalid. Re-select the spreadsheet and try again.',
      );
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new BadRequestException('The import file contains no data rows');
    }

    if (parsed.length > 100_000) {
      throw new BadRequestException(
        'A single import cannot contain more than 100,000 rows',
      );
    }

    return parsed as JsonRow[];
  }

  private parseBoolean(value: unknown, rowNumber: number) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;

    const normalized = this.cleanText(value).toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0'].includes(normalized)) return false;

    throw new BadRequestException(
      `Row ${rowNumber}: billable must be TRUE/FALSE, YES/NO or 1/0`,
    );
  }

  private parseLayerRows(rows: JsonRow[]) {
    const parsed: LayerImportRow[] = [];
    const layerIds = new Set<string>();
    const logicalKeys = new Set<string>();

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const layerId = this.cleanText(row.layer_id ?? row.LayerID);
      const flatId = this.cleanText(row.flat_id ?? row.FlatID);
      const layerName = this.cleanText(row.layer_name ?? row.layer ?? row.Layer);
      const block = this.cleanText(row.block ?? row.Block);
      const application = this.cleanText(row.application ?? row.Application);
      const flat = this.cleanText(row.flat ?? row.Flat);
      const orderRaw = row.order ?? row.Order;
      const orderText = this.cleanText(orderRaw);
      const orderValue = orderText === '' ? 999 : Number(orderRaw);

      const missing = [
        ['layer_id', layerId],
        ['flat_id', flatId],
        ['layer_name', layerName],
        ['block', block],
        ['application', application],
        ['flat', flat],
      ].filter(([, value]) => !value);

      if (missing.length) {
        throw new BadRequestException(
          `Row ${rowNumber}: missing ${missing.map(([name]) => name).join(', ')}`,
        );
      }

      if (orderText !== '' && !Number.isFinite(orderValue)) {
        throw new BadRequestException(
          `Row ${rowNumber}: order must be numeric when provided`,
        );
      }

      const billable = this.parseBoolean(
        row.billable ?? row.Billable,
        rowNumber,
      );

      if (layerIds.has(layerId)) {
        throw new BadRequestException(
          `Row ${rowNumber}: duplicate layer_id ${layerId} inside the import file`,
        );
      }
      layerIds.add(layerId);

      const logicalKey = [application, flat, layerName]
        .map((value) => value.toUpperCase())
        .join('|');
      if (logicalKeys.has(logicalKey)) {
        throw new BadRequestException(
          `Row ${rowNumber}: duplicate Application + Flat + Layer combination`,
        );
      }
      logicalKeys.add(logicalKey);

      parsed.push({
        layerId,
        flatId,
        layerName,
        block,
        application,
        flat,
        order: orderValue,
        billable,
      });
    });

    return parsed;
  }

  private parseSurfaceRows(rows: JsonRow[]) {
    const parsed: SurfaceImportRow[] = [];
    const logicalKeys = new Set<string>();

    const parseNonNegativeNumber = (
      value: unknown,
      rowNumber: number,
      columnName: string,
    ) => {
      if (value === null || value === undefined || this.cleanText(value) === '') {
        throw new BadRequestException(
          `Row ${rowNumber}: ${columnName} is required`,
        );
      }

      const numberValue = Number(value);
      if (!Number.isFinite(numberValue) || numberValue < 0) {
        throw new BadRequestException(
          `Row ${rowNumber}: ${columnName} must be a non-negative number`,
        );
      }
      return numberValue;
    };


    const parseOptionalNonNegativeNumber = (
      value: unknown,
      rowNumber: number,
      columnName: string,
    ): number | null => {
      if (value === null || value === undefined || this.cleanText(value) === '') {
        return null;
      }

      const numberValue = Number(value);
      if (!Number.isFinite(numberValue) || numberValue < 0) {
        throw new BadRequestException(
          `Row ${rowNumber}: ${columnName} must be a non-negative number when provided`,
        );
      }
      return numberValue;
    };

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const block = this.cleanText(row.block ?? row.Block);
      const application = this.cleanText(row.application ?? row.Application);
      const base = this.cleanText(row.base ?? row.Base);
      const wall = this.cleanText(row.wall ?? row.Wall);
      const rawSurfaceType = this.cleanText(
        row.surface_type ?? row['surface_type'] ?? row['Surface Type'],
      ).toLowerCase();

      const missing = [
        ['block', block],
        ['application', application],
        ['base', base],
        ['wall', wall],
        ['surface_type', rawSurfaceType],
      ].filter(([, value]) => !value);

      if (missing.length) {
        throw new BadRequestException(
          `Row ${rowNumber}: missing ${missing.map(([name]) => name).join(', ')}`,
        );
      }

      if (!['ceiling', 'wall'].includes(rawSurfaceType)) {
        throw new BadRequestException(
          `Row ${rowNumber}: surface_type must be ceiling or wall`,
        );
      }

      const totalAreaSft = parseNonNegativeNumber(
        row.total_area_sft ?? row['total_area_sft'],
        rowNumber,
        'total_area_sft',
      );
      const lengthPositive = parseOptionalNonNegativeNumber(
        row.length_positive ?? row['length(+ve)'],
        rowNumber,
        'length(+ve)',
      );
      const widthPositive = parseOptionalNonNegativeNumber(
        row.width_positive ?? row['width(+ve)'],
        rowNumber,
        'width(+ve)',
      );
      const heightPositive = parseOptionalNonNegativeNumber(
        row.height_positive ?? row['height(+ve)'],
        rowNumber,
        'height(+ve)',
      );
      const positiveArea = parseOptionalNonNegativeNumber(
        row.positive_area ?? row['positive_area'],
        rowNumber,
        'positive_area',
      );
      const lengthNegative = parseOptionalNonNegativeNumber(
        row.length_negative ?? row['length(-ve)'],
        rowNumber,
        'length(-ve)',
      );
      const widthNegative = parseOptionalNonNegativeNumber(
        row.width_negative ?? row['width(-ve)'],
        rowNumber,
        'width(-ve)',
      );
      const heightNegative = parseOptionalNonNegativeNumber(
        row.height_negative ?? row['height(-ve)'],
        rowNumber,
        'height(-ve)',
      );
      const negativeArea = parseOptionalNonNegativeNumber(
        row.negative_area ?? row['negative_area'],
        rowNumber,
        'negative_area',
      );
      const length2Negative = parseOptionalNonNegativeNumber(
        row.length_2_negative ?? row['length_2(-ve)'],
        rowNumber,
        'length_2(-ve)',
      );
      const width2Negative = parseOptionalNonNegativeNumber(
        row.width_2_negative ?? row['width_2(-ve)'],
        rowNumber,
        'width_2(-ve)',
      );
      const height2Negative = parseOptionalNonNegativeNumber(
        row.height_2_negative ?? row['height_2(-ve)'],
        rowNumber,
        'height_2(-ve)',
      );

      const logicalKey = [application, base, wall]
        .map((value) => value.toUpperCase())
        .join('|');
      if (logicalKeys.has(logicalKey)) {
        throw new BadRequestException(
          `Row ${rowNumber}: duplicate application + base + wall combination`,
        );
      }
      logicalKeys.add(logicalKey);

      parsed.push({
        block,
        application,
        base,
        wall,
        surfaceType: rawSurfaceType as 'ceiling' | 'wall',
        totalAreaSft,
        lengthPositive,
        widthPositive,
        heightPositive,
        positiveArea,
        lengthNegative,
        widthNegative,
        heightNegative,
        negativeArea,
        length2Negative,
        width2Negative,
        height2Negative,
      });
    });

    return parsed;
  }

  private parseCostBoqRows(rows: JsonRow[]) {
    const parsed: CostBoqImportRow[] = [];
    const logicalKeys = new Set<string>();

    const parseRequiredNumber = (
      value: unknown,
      rowNumber: number,
      columnName: string,
      options?: { positive?: boolean },
    ) => {
      if (value === null || value === undefined || this.cleanText(value) === '') {
        throw new BadRequestException(
          `Row ${rowNumber}: ${columnName} is required`,
        );
      }

      const numberValue = Number(value);
      const invalid =
        !Number.isFinite(numberValue) ||
        (options?.positive ? numberValue <= 0 : numberValue < 0);

      if (invalid) {
        throw new BadRequestException(
          `Row ${rowNumber}: ${columnName} must be ${
            options?.positive ? 'greater than 0' : 'a non-negative number'
          }`,
        );
      }

      return numberValue;
    };

    const parseOptionalNumber = (
      value: unknown,
      rowNumber: number,
      columnName: string,
      options?: { positive?: boolean },
    ) => {
      if (value === null || value === undefined || this.cleanText(value) === '') {
        return null;
      }

      const numberValue = Number(value);
      const invalid =
        !Number.isFinite(numberValue) ||
        (options?.positive ? numberValue <= 0 : numberValue < 0);

      if (invalid) {
        throw new BadRequestException(
          `Row ${rowNumber}: ${columnName} must be ${
            options?.positive ? 'greater than 0' : 'a non-negative number'
          }`,
        );
      }

      return numberValue;
    };

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const application = this.cleanText(row.application ?? row.Application);
      const layerName = this.cleanText(
        row.layer ?? row.Layer ?? row.layer_name ?? row.LayerName,
      );
      const materialNameRaw = this.cleanText(
        row.material_name ?? row['Material Name'],
      );
      const materialName = materialNameRaw || null;

      const missing = [
        ['application', application],
        ['layer', layerName],
      ].filter(([, value]) => !value);

      if (missing.length) {
        throw new BadRequestException(
          `Row ${rowNumber}: missing ${missing.map(([name]) => name).join(', ')}`,
        );
      }

      const productivity = parseOptionalNumber(
        row.productivity ?? row.Productivity,
        rowNumber,
        'productivity',
        { positive: true },
      );
      const perLabourCost = parseOptionalNumber(
        row.per_labour_cost ?? row['Per Labour Cost'],
        rowNumber,
        'per_labour_cost',
      );
      const clientRate = parseOptionalNumber(
        row.client_rate ?? row['Client Rate'] ?? row.Rate ?? row.rate,
        rowNumber,
        'client_rate',
      );

      const materialCoverage = parseOptionalNumber(
        row.material_coverage ?? row['Material Coverage'],
        rowNumber,
        'material_coverage',
        { positive: true },
      );
      const materialRatePerUnit = parseOptionalNumber(
        row.material_rate_per_unit ?? row['Material Rate per Unit'],
        rowNumber,
        'material_rate_per_unit',
      );

      if (materialName) {
        if (materialCoverage === null) {
          throw new BadRequestException(
            `Row ${rowNumber}: material_coverage is required when material_name is provided`,
          );
        }
        if (materialRatePerUnit === null) {
          throw new BadRequestException(
            `Row ${rowNumber}: material_rate_per_unit is required when material_name is provided`,
          );
        }
      } else if (materialCoverage !== null || materialRatePerUnit !== null) {
        throw new BadRequestException(
          `Row ${rowNumber}: material_name is required when material coverage or rate is provided`,
        );
      }

      const logicalKey = [application, layerName]
        .map((value) => value.toUpperCase())
        .join('|');

      if (logicalKeys.has(logicalKey)) {
        throw new BadRequestException(
          `Row ${rowNumber}: duplicate Application + Layer combination`,
        );
      }
      logicalKeys.add(logicalKey);

      parsed.push({
        application,
        layerName,
        productivity,
        perLabourCost,
        materialName,
        materialCoverage,
        materialRatePerUnit,
        clientRate,
      });
    });

    return parsed;
  }

  private async ensureProjectExists(projectId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{ project_id: string }>
    >`
      select project_id
      from public.zos_project_registry
      where project_id = ${projectId}
      limit 1
    `;

    if (!rows.length) {
      throw new NotFoundException('Project not found in Project Setup');
    }
  }

  async listProjects() {
    const rows = await this.prisma.$queryRaw<
      Array<{
        project_id: string;
        project_name: string;
        created_at: Date;
      }>
    >`
      select
        project_id,
        project_name,
        created_at
      from public.zos_project_registry
      order by project_name
    `;

    return rows.map((row) => ({
      projectId: row.project_id,
      projectName: row.project_name,
      createdAt: row.created_at,
    }));
  }

  async createProject(dto: CreateProjectDto) {
    const projectId = this.normalizeProjectId(dto.projectId);
    const projectName = this.cleanText(dto.projectName);
    const projectCode = projectId.replace(/_/g, '-').toUpperCase();

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            project_id: string;
            project_name: string;
            created_at: Date;
          }>
        >`
          insert into public.zos_project_registry (
            project_id,
            project_name
          )
          values (${projectId}, ${projectName})
          returning project_id, project_name, created_at
        `;

        // Keep the operational project master in sync with the admin registry.
        // material_master and future project-scoped engines depend on this row.
        await tx.$executeRaw`
          insert into indr.project_master as pm (
            project_id,
            project_name,
            project_code,
            status
          )
          values (
            ${projectId},
            ${projectName},
            ${projectCode},
            'Active'
          )
          on conflict (project_id)
          do update set
            project_name = excluded.project_name,
            project_code = excluded.project_code,
            status = coalesce(nullif(trim(pm.status), ''), excluded.status)
        `;

        return rows[0];
      });

      return {
        projectId: row.project_id,
        projectName: row.project_name,
        createdAt: row.created_at,
      };
    } catch (error) {
      if (String(error).toLowerCase().includes('unique')) {
        throw new ConflictException('Project ID already exists');
      }
      throw error;
    }
  }

  async getProjectStatus(projectIdValue: string) {
    const projectId = this.normalizeProjectId(projectIdValue);
    await this.ensureProjectExists(projectId);

    const [row] = await this.prisma.$queryRaw<
      Array<{
        layer_count: bigint;
        surface_count: bigint;
        flat_area_count: bigint;
        boq_count: bigint;
        material_count: bigint;
        productivity_count: bigint;
        costing_count: bigint;
      }>
    >`
      select
        (select count(*) from indr.layer where project_id = ${projectId}) as layer_count,
        (select count(*) from indr.surface_number where project_id = ${projectId}) as surface_count,
        (select count(*) from indr.flat_area_summary where project_id = ${projectId}) as flat_area_count,
        (
          select count(*)
          from public.boq
          where project_id = ${projectId}
             or (
               ${projectId} = 'park_heights'
               and nullif(trim(project_id), '') is null
             )
        ) as boq_count,
        (
          select count(*)
          from indr.material_master
          where project_id = ${projectId}
            and upper(trim(coalesce(status, 'Active'))) = 'ACTIVE'
        ) as material_count,
        (
          select count(*)
          from indr.productivity_master
          where project_id = ${projectId}
        ) as productivity_count,
        (
          select count(*)
          from indr.project_flat_layer_costing
          where project_id = ${projectId}
        ) as costing_count
    `;

    return {
      projectId,
      layerCount: Number(row?.layer_count ?? 0),
      surfaceCount: Number(row?.surface_count ?? 0),
      flatAreaCount: Number(row?.flat_area_count ?? 0),
      boqCount: Number(row?.boq_count ?? 0),
      materialCount: Number(row?.material_count ?? 0),
      productivityCount: Number(row?.productivity_count ?? 0),
      costingCount: Number(row?.costing_count ?? 0),
    };
  }

  async importLayers(projectIdValue: string, file: any) {
    const projectId = this.normalizeProjectId(projectIdValue);
    await this.ensureProjectExists(projectId);
    const rows = this.parseLayerRows(this.parseUploadedRows(file));

    // layer_id is still the physical primary key in the current production
    // table. Reject an import that tries to reuse another project's layer_id
    // instead of silently skipping or overwriting that project's data.
    for (let index = 0; index < rows.length; index += 500) {
      const batch = rows.slice(index, index + 500);
      const layerIds = batch.map((row) => row.layerId);

      const idConflicts = await this.prisma.$queryRaw<
        Array<{ layer_id: string; project_id: string | null }>
      >(
        Prisma.sql`
          select layer_id, project_id
          from indr.layer
          where layer_id in (${Prisma.join(layerIds)})
            and coalesce(project_id, '') <> ${projectId}
          limit 10
        `,
      );

      if (idConflicts.length) {
        throw new ConflictException(
          `Layer IDs already belong to another project: ${idConflicts
            .map((row) => row.layer_id)
            .join(', ')}`,
        );
      }

      // Protect against an older/global logical unique constraint as well.
      // If another project already owns the same Application + Flat + Layer,
      // report it instead of silently skipping the new project's row.
      const logicalValues = batch.map((row) => Prisma.sql`(
        ${row.application},
        ${row.flat},
        ${row.layerName}
      )`);

      const logicalConflicts = await this.prisma.$queryRaw<
        Array<{
          layer_id: string;
          project_id: string | null;
          application: string | null;
          flat: string | null;
          layer_name: string;
        }>
      >(
        Prisma.sql`
          with incoming(application, flat, layer_name) as (
            values ${Prisma.join(logicalValues)}
          )
          select
            l.layer_id,
            l.project_id,
            l.application,
            l.flat,
            l.layer_name
          from indr.layer l
          join incoming i
            on upper(trim(coalesce(l.application, '')))
               = upper(trim(i.application))
           and upper(trim(coalesce(l.flat, '')))
               = upper(trim(i.flat))
           and upper(trim(coalesce(l.layer_name, '')))
               = upper(trim(i.layer_name))
          where coalesce(l.project_id, '') <> ${projectId}
          limit 10
        `,
      );

      if (logicalConflicts.length) {
        throw new ConflictException(
          `Application + Flat + Layer already belongs to another project: ${logicalConflicts
            .map(
              (row) =>
                `${row.application ?? ''} / ${row.flat ?? ''} / ${row.layer_name}`,
            )
            .join(', ')}`,
        );
      }
    }

    let insertedRows = 0;

    await this.prisma.$transaction(
      async (tx) => {
        // APPEND ONLY:
        // - Existing layer rows are never deleted.
        // - Existing layer rows are never updated.
        // - Matching PK/logical unique rows are skipped.
        // - New rows start with wkdpct = 0.
        for (let index = 0; index < rows.length; index += 500) {
          const batch = rows.slice(index, index + 500);

          const values = batch.map((row) => Prisma.sql`(
            ${row.layerId},
            ${row.flatId},
            ${row.layerName},
            ${row.block},
            ${row.application},
            ${row.flat},
            ${row.order},
            ${row.billable},
            ${projectId},
            0
          )`);

          const affected = await tx.$executeRaw(
            Prisma.sql`
              insert into indr.layer (
                layer_id,
                flat_id,
                layer_name,
                block,
                application,
                flat,
                "order",
                billable,
                project_id,
                wkdpct
              )
              values ${Prisma.join(values)}
              on conflict do nothing
            `,
          );

          insertedRows += Number(affected ?? 0);
        }
      },
      {
        maxWait: 20_000,
        timeout: 120_000,
      },
    );

    return {
      message: 'Layer data appended successfully',
      projectId,
      uploadedRows: rows.length,
      importedRows: insertedRows,
      skippedRows: rows.length - insertedRows,
    };
  }

  async importSurfaces(projectIdValue: string, file: any) {
    const projectId = this.normalizeProjectId(projectIdValue);
    await this.ensureProjectExists(projectId);
    const rows = this.parseSurfaceRows(this.parseUploadedRows(file));

    // Fail early if the database is missing any of the 17 import columns.
    // All measurement columns are optional in the file, but must exist in SQL.
    const requiredDatabaseColumns = [
      'block',
      'application',
      'base',
      'wall',
      'surface_type',
      'total_area_sft',
      'length(+ve)',
      'width(+ve)',
      'height(+ve)',
      'positive_area',
      'length(-ve)',
      'width(-ve)',
      'height(-ve)',
      'negative_area',
      'length_2(-ve)',
      'width_2(-ve)',
      'height_2(-ve)',
      'project_id',
    ];

    const existingColumns = await this.prisma.$queryRaw<
      Array<{ column_name: string }>
    >`
      select column_name
      from information_schema.columns
      where table_schema = 'indr'
        and table_name = 'surface_number'
    `;

    const existingColumnNames = new Set(
      existingColumns.map((column) => column.column_name),
    );
    const missingColumns = requiredDatabaseColumns.filter(
      (column) => !existingColumnNames.has(column),
    );

    if (missingColumns.length) {
      throw new InternalServerErrorException(
        `Surface Number database is missing required columns: ${missingColumns.join(
          ', ',
        )}. Confirm that these columns exist in indr.surface_number before importing.`,
      );
    }

    let appendedRows = 0;
    let skippedExistingRows = 0;

    try {
      await this.prisma.$transaction(
        async (tx) => {
          // APPEND-ONLY import:
          // Existing Surface Number rows are NEVER deleted or updated here.
          // If the same project + application + base + wall already exists,
          // that uploaded row is skipped and the existing database row wins.
          const existingRows = await tx.$queryRaw<
            Array<{ application: string; base: string; wall: string }>
          >`
            select application, base, wall
            from indr.surface_number
            where project_id = ${projectId}
          `;

          const existingKeys = new Set(
            existingRows.map((row) =>
              [row.application, row.base, row.wall]
                .map((value) => String(value ?? '').trim().toUpperCase())
                .join('||'),
            ),
          );

          const rowsToInsert = rows.filter((row) => {
            const key = [row.application, row.base, row.wall]
              .map((value) => String(value ?? '').trim().toUpperCase())
              .join('||');

            if (existingKeys.has(key)) {
              skippedExistingRows += 1;
              return false;
            }

            // Also prevent a duplicate key repeated inside the same upload.
            existingKeys.add(key);
            return true;
          });

          appendedRows = rowsToInsert.length;

          // Keep each INSERT comfortably below PostgreSQL parameter limits,
          // while avoiding thousands of individual INSERT statements.
          const batchSize = 500;

          for (let index = 0; index < rowsToInsert.length; index += batchSize) {
            const batch = rowsToInsert.slice(index, index + batchSize);
            const values = batch.map((row) => Prisma.sql`(
              ${row.block},
              ${row.application},
              ${row.base},
              ${row.wall},
              ${row.surfaceType},
              ${row.totalAreaSft},
              ${row.lengthPositive},
              ${row.widthPositive},
              ${row.heightPositive},
              ${row.positiveArea},
              ${row.lengthNegative},
              ${row.widthNegative},
              ${row.heightNegative},
              ${row.negativeArea},
              ${row.length2Negative},
              ${row.width2Negative},
              ${row.height2Negative},
              ${projectId}
            )`);

            await tx.$executeRaw(
              Prisma.sql`
                insert into indr.surface_number (
                  block,
                  application,
                  base,
                  wall,
                  surface_type,
                  total_area_sft,
                  "length(+ve)",
                  "width(+ve)",
                  "height(+ve)",
                  positive_area,
                  "length(-ve)",
                  "width(-ve)",
                  "height(-ve)",
                  negative_area,
                  "length_2(-ve)",
                  "width_2(-ve)",
                  "height_2(-ve)",
                  project_id
                )
                values ${Prisma.join(values)}
              `,
            );
          }

          // Keep the generic flat-area summary current immediately after a
          // successful Surface Number append. This makes new projects visible
          // to Home/Projection before a later Cost / BOQ import is required.
          await tx.$executeRaw`
            select indr.refresh_flat_area_summary(${projectId})
          `;
        },
        {
          // Prisma interactive transactions default to a short timeout.
          // Large Surface imports (8k+ rows) can legitimately take longer.
          maxWait: 20_000,
          timeout: 120_000,
        },
      );
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : String(error ?? '');
      const normalizedMessage = rawMessage.toLowerCase();

      this.logger.error(
        `Surface import failed for project ${projectId}: ${rawMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      if (
        normalizedMessage.includes('p2028') ||
        (normalizedMessage.includes('transaction') &&
          normalizedMessage.includes('timeout'))
      ) {
        throw new RequestTimeoutException(
          `Surface import timed out while writing ${rows.length.toLocaleString(
            'en-IN',
          )} rows. The transaction was rolled back; no partial import was saved.`,
        );
      }

      if (
        normalizedMessage.includes('unique constraint') ||
        normalizedMessage.includes('duplicate key')
      ) {
        throw new ConflictException(
          'Surface append contains a value that conflicts with a database unique constraint outside the selected project. No existing surface rows were deleted; the transaction was rolled back.',
        );
      }

      throw new InternalServerErrorException(
        `Surface import failed while writing ${rows.length.toLocaleString(
          'en-IN',
        )} rows. The transaction was rolled back. Check the backend log for the exact database error.`,
      );
    }

    return {
      message: 'Surface data appended successfully',
      projectId,
      importedRows: rows.length,
      appendedRows,
      skippedExistingRows,
    };
  }


  async importCostBoq(projectIdValue: string, file: any) {
    const projectId = this.normalizeProjectId(projectIdValue);
    await this.ensureProjectExists(projectId);
    const rows = this.parseCostBoqRows(this.parseUploadedRows(file));

    const hasMaterialRows = rows.some((row) => row.materialName);

    if (hasMaterialRows) {
      const projectMasterRows = await this.prisma.$queryRaw<
        Array<{ project_id: string }>
      >`
        select project_id
        from indr.project_master
        where project_id = ${projectId}
        limit 1
      `;

      if (!projectMasterRows.length) {
        throw new BadRequestException(
          `Project ${projectId} is not present in indr.project_master, so material_master rows cannot be created yet.`,
        );
      }
    }

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          // flat_area_summary is derived from the current Surface Number data.
          // The PostgreSQL function returns void, so use $executeRaw rather
          // than $queryRaw to avoid Prisma trying to deserialize a void value.
          await tx.$executeRaw`
            select indr.refresh_flat_area_summary(${projectId})
          `;

          const flatAreaRows = await tx.$queryRaw<
            Array<{
              block: string;
              application: string;
              application_area: unknown;
              flat_count: bigint;
            }>
          >`
            select
              block,
              application,
              sum(total_area_sft) as application_area,
              count(*) as flat_count
            from indr.flat_area_summary
            where project_id = ${projectId}
            group by block, application
          `;

          const areasByApplication = new Map<
            string,
            Array<{ block: string; area: number; flatCount: number }>
          >();

          for (const areaRow of flatAreaRows) {
            const applicationKey = this.cleanText(
              areaRow.application,
            ).toUpperCase();
            const existing = areasByApplication.get(applicationKey) ?? [];

            existing.push({
              block: this.cleanText(areaRow.block),
              area: Number(areaRow.application_area ?? 0) || 0,
              flatCount: Number(areaRow.flat_count ?? 0),
            });

            areasByApplication.set(applicationKey, existing);
          }

          const missingApplications = Array.from(
            new Set(
              rows
                .filter(
                  (row) =>
                    !areasByApplication.has(row.application.toUpperCase()),
                )
                .map((row) => row.application),
            ),
          );

          if (missingApplications.length) {
            throw new BadRequestException(
              `No flat area summary exists for application(s): ${missingApplications
                .slice(0, 10)
                .join(', ')}. Import Surface Number data first.`,
            );
          }

          const keyBatchSize = 500;

          // ==============================================================
          // BOQ
          // Replace ONLY Application + Layer combinations present in this
          // import. Unrelated existing BOQ rows remain untouched.
          // ==============================================================
          for (let index = 0; index < rows.length; index += keyBatchSize) {
            const batch = rows.slice(index, index + keyBatchSize);
            const keys = batch.map((row) => Prisma.sql`(
              ${row.application},
              ${row.layerName}
            )`);

            await tx.$executeRaw(
              Prisma.sql`
                with imported(application, layer_name) as (
                  values ${Prisma.join(keys)}
                )
                delete from public.boq b
                using imported i
                where (
                  b.project_id = ${projectId}
                  or (
                    ${projectId} = 'park_heights'
                    and nullif(trim(b.project_id), '') is null
                  )
                )
                  and upper(trim(coalesce(b."Application", ''))) =
                      upper(trim(i.application))
                  and upper(trim(coalesce(b."Layer", ''))) =
                      upper(trim(i.layer_name))
              `,
            );
          }

          const boqRowsToInsert = rows.flatMap((row) => {
            const applicationAreas =
              areasByApplication.get(row.application.toUpperCase()) ?? [];

            return applicationAreas.map((areaRow) => ({
              ...row,
              block: areaRow.block,
              applicationArea: areaRow.area,
            }));
          });

          for (
            let index = 0;
            index < boqRowsToInsert.length;
            index += 500
          ) {
            const batch = boqRowsToInsert.slice(index, index + 500);
            const values = batch.map((row) => Prisma.sql`(
              ${row.application},
              ${row.layerName},
              ${row.applicationArea},
              ${row.materialName},
              ${row.clientRate},
              ${row.block},
              ${projectId}
            )`);

            await tx.$executeRaw(
              Prisma.sql`
                insert into public.boq (
                  "Application",
                  "Layer",
                  "Area",
                  "Material Name",
                  "Client Rate",
                  block,
                  project_id
                )
                values ${Prisma.join(values)}
              `,
            );
          }

          // ==============================================================
          // MATERIAL MASTER
          // Deactivate ONLY matching imported Application + Layer records.
          // If the new import has no material for that layer, no new Active
          // material row is created, which intentionally clears its mapping.
          // ==============================================================
          for (let index = 0; index < rows.length; index += keyBatchSize) {
            const batch = rows.slice(index, index + keyBatchSize);
            const keys = batch.map((row) => Prisma.sql`(
              ${row.application},
              ${row.layerName}
            )`);

            await tx.$executeRaw(
              Prisma.sql`
                with imported(application, layer_name) as (
                  values ${Prisma.join(keys)}
                )
                update indr.material_master m
                set
                  status = 'Inactive',
                  updated_at = now()
                from imported i
                where m.project_id = ${projectId}
                  and upper(trim(m.application)) = upper(trim(i.application))
                  and upper(trim(m.work_layer)) = upper(trim(i.layer_name))
                  and upper(trim(coalesce(m.status, 'Active'))) = 'ACTIVE'
              `,
            );
          }

          const materialRows = rows.filter(
            (row): row is CostBoqImportRow & {
              materialName: string;
              materialCoverage: number;
              materialRatePerUnit: number;
            } =>
              Boolean(row.materialName) &&
              row.materialCoverage !== null &&
              row.materialRatePerUnit !== null,
          );

          for (let index = 0; index < materialRows.length; index += 500) {
            const batch = materialRows.slice(index, index + 500);
            const values = batch.map((row) => Prisma.sql`(
              ${projectId},
              ${row.application},
              ${row.layerName},
              ${row.materialName},
              ${row.materialCoverage},
              ${row.materialRatePerUnit},
              'Active'
            )`);

            await tx.$executeRaw(
              Prisma.sql`
                insert into indr.material_master (
                  project_id,
                  application,
                  work_layer,
                  material_name,
                  coverage,
                  unit_cost,
                  status
                )
                values ${Prisma.join(values)}
              `,
            );
          }

          // ==============================================================
          // PRODUCTIVITY MASTER
          // Every imported Application + Layer is represented by exactly
          // three modes: Machine, Manual and Both, all carrying the imported
          // daily productivity value. Only matching Application + Layer rows
          // are replaced; unrelated productivity rows remain untouched.
          // ==============================================================
          for (let index = 0; index < rows.length; index += keyBatchSize) {
            const batch = rows.slice(index, index + keyBatchSize);
            const keys = batch.map((row) => Prisma.sql`(
              ${row.application},
              ${row.layerName}
            )`);

            await tx.$executeRaw(
              Prisma.sql`
                with imported(application, layer_name) as (
                  values ${Prisma.join(keys)}
                )
                delete from indr.productivity_master p
                using imported i
                where p.project_id = ${projectId}
                  and upper(trim(p.application)) = upper(trim(i.application))
                  and upper(trim(p.work_layer)) = upper(trim(i.layer_name))
              `,
            );
          }

          const productivityModes = ['Machine', 'Manual', 'Both'] as const;
          const productivityRows = rows
            .filter(
              (row): row is CostBoqImportRow & { productivity: number } =>
                row.productivity !== null,
            )
            .flatMap((row) =>
              productivityModes.map((mode) => ({
                application: row.application,
                workLayer: row.layerName,
                mode,
                productivity: row.productivity,
              })),
            );

          for (
            let index = 0;
            index < productivityRows.length;
            index += 500
          ) {
            const batch = productivityRows.slice(index, index + 500);
            const values = batch.map((row) => Prisma.sql`(
              ${projectId},
              ${row.workLayer},
              ${row.application},
              ${row.mode},
              ${row.productivity},
              now(),
              now()
            )`);

            await tx.$executeRaw(
              Prisma.sql`
                insert into indr.productivity_master (
                  project_id,
                  work_layer,
                  application,
                  machine_or_manual,
                  ideal_productivity_sqft_hr,
                  created_at,
                  updated_at
                )
                values ${Prisma.join(values)}
              `,
            );
          }

          // ==============================================================
          // FLAT x LAYER COSTING
          // The database function is migration-updated to replace only the
          // imported Application + Layer combinations, leaving every unrelated
          // costing row intact.
          // ==============================================================
          const costingPayload = rows.map((row) => ({
            application: row.application,
            layer_name: row.layerName,
            productivity: row.productivity,
            per_labour_cost: row.perLabourCost,
            material_name: row.materialName,
            material_coverage: row.materialCoverage,
            material_rate_per_unit: row.materialRatePerUnit,
            client_rate: row.clientRate,
          }));

          const [generated] = await tx.$queryRaw<
            Array<{ generated_rows: bigint }>
          >`
            select generated_rows
            from indr.replace_project_flat_layer_costing(
              ${projectId},
              ${JSON.stringify(costingPayload)}::jsonb
            )
          `;

          return {
            boqRows: boqRowsToInsert.length,
            materialRows: materialRows.length,
            productivityRows: productivityRows.length,
            generatedRows: Number(generated?.generated_rows ?? 0),
            flatAreaRows: flatAreaRows.reduce(
              (sum, row) => sum + Number(row.flat_count ?? 0),
              0,
            ),
          };
        },
        {
          maxWait: 20_000,
          timeout: 120_000,
        },
      );

      return {
        message: 'Cost / BOQ data updated successfully',
        projectId,
        importedRows: rows.length,
        boqRows: result.boqRows,
        materialRows: result.materialRows,
        productivityRows: result.productivityRows,
        generatedRows: result.generatedRows,
        flatAreaRows: result.flatAreaRows,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      const rawMessage =
        error instanceof Error ? error.message : String(error ?? '');
      const normalizedMessage = rawMessage.toLowerCase();

      this.logger.error(
        `Cost / BOQ import failed for project ${projectId}: ${rawMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      if (
        normalizedMessage.includes('p2028') ||
        (normalizedMessage.includes('transaction') &&
          normalizedMessage.includes('timeout'))
      ) {
        throw new RequestTimeoutException(
          `Cost / BOQ import timed out while processing ${rows.length.toLocaleString(
            'en-IN',
          )} template rows. The transaction was rolled back.`,
        );
      }

      if (
        normalizedMessage.includes('unique constraint') ||
        normalizedMessage.includes('duplicate key')
      ) {
        throw new ConflictException(
          'Cost / BOQ import conflicts with an existing unique database record. The transaction was rolled back.',
        );
      }

      throw new InternalServerErrorException(
        `Cost / BOQ import failed while processing ${rows.length.toLocaleString(
          'en-IN',
        )} template rows. The transaction was rolled back. Check the backend log for the exact database error.`,
      );
    }
  }

}