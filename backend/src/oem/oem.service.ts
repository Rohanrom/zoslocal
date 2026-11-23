import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type IdRow = { id: string };
type CountRow = { count: bigint | number | string };
type QuotationLineInput = {
  packId: string;
  packPrice: number;
  coverage: number;
  remark: string | null;
};

const UUID = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function name(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new BadRequestException(`${label} must contain 1 to ${max} characters`);
  }
  return value.trim().replace(/\s+/g, ' ');
}
function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return value;
}
function positive(value: unknown, label: string, max = 1e12): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max ||
      Math.abs(value - Number(value.toFixed(4))) > 1e-9) {
    throw new BadRequestException(`${label} must be positive with up to four decimal places`);
  }
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new BadRequestException('Quotation date must use YYYY-MM-DD');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Invalid quotation date');
  }
  return value;
}
function lines(value: unknown): QuotationLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 300) {
    throw new BadRequestException('A quotation requires 1–300 material lines');
  }
  const result = value.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException(`Line ${i + 1} must be an object`);
    }
    const row = raw as Record<string, unknown>;
    if (row.remark != null && typeof row.remark !== 'string') {
      throw new BadRequestException(`Line ${i + 1}: remark must be text`);
    }
    if (String(row.remark ?? '').length > 1000) {
      throw new BadRequestException(`Line ${i + 1}: remark exceeds 1000 characters`);
    }
    return {
      packId: id(row.packId, `pack ID on line ${i + 1}`),
      packPrice: positive(row.packPrice, `Pack price on line ${i + 1}`),
      coverage: positive(row.coverage, `Coverage on line ${i + 1}`),
      remark: String(row.remark ?? '').trim() || null,
    };
  });
  if (new Set(result.map(x => x.packId)).size !== result.length) {
    throw new ConflictException('The same material and pack size can appear only once in a quotation');
  }
  return result;
}

@Injectable()
export class OemService {
  constructor(private readonly prisma: PrismaService) {}

  async masterData() {
    const [brands, categories, projects] = await Promise.all([
      this.prisma.$queryRaw<Array<{ brandId: string; brandName: string }>>`
        SELECT brand_id AS "brandId", brand_name AS "brandName"
        FROM oem.brands ORDER BY lower(brand_name), brand_id`,
      this.prisma.$queryRaw<Array<{ categoryId: string; categoryName: string }>>`
        SELECT category_id AS "categoryId", category_name AS "categoryName"
        FROM oem.categories ORDER BY lower(category_name), category_id`,
      this.prisma.$queryRaw<Array<{ projectId: string; projectName: string }>>`
        SELECT project_id AS "projectId", project_name AS "projectName"
        FROM oem.projects ORDER BY lower(project_name), project_id`,
    ]);
    return { brands, categories, projects };
  }

  async materials() {
    return this.prisma.$queryRaw<Array<{
      materialId: string; brandId: string; brandName: string;
      categoryId: string; categoryName: string; materialName: string;
      unit: string; packs: Array<{ packId: string; packSize: number }>;
    }>>`
      SELECT m.material_id AS "materialId", b.brand_id AS "brandId",
        b.brand_name AS "brandName", c.category_id AS "categoryId",
        c.category_name AS "categoryName", m.material_name AS "materialName",
        m.unit,
        coalesce(jsonb_agg(jsonb_build_object('packId', p.pack_id, 'packSize', p.pack_size)
          ORDER BY p.pack_size, p.pack_id)
          FILTER (WHERE p.pack_id IS NOT NULL), '[]'::jsonb) AS packs
      FROM oem.materials m
      JOIN oem.brands b ON b.brand_id = m.brand_id
      JOIN oem.categories c ON c.category_id = m.category_id
      LEFT JOIN oem.material_packs p ON p.material_id = m.material_id
      GROUP BY m.material_id, b.brand_id, c.category_id
      ORDER BY lower(b.brand_name), lower(c.category_name), lower(m.material_name), m.material_id
    `;
  }

  async registerMaterial(body: Record<string, unknown>, actor?: string) {
    const brandName = name(body.brandName, 'Brand', 160);
    const categoryName = name(body.categoryName, 'Category', 160);
    const materialName = name(body.materialName, 'Material name', 240);
    const unit = body.unit;
    if (unit !== 'KG' && unit !== 'L' && unit !== 'Piece') {
      throw new BadRequestException('Unit must be KG, L or Piece');
    }
    const packSize = positive(body.packSize, 'Pack size', 9999999999);
    const materialId = body.materialId == null ? null : id(body.materialId, 'material ID');
    const by = actor?.slice(0, 200) || null;

    return this.prisma.$transaction(async tx => {
      // Brand/category are registered only when the complete Add Material form is saved.
      await tx.$executeRaw`
        INSERT INTO oem.brands (brand_name, created_by, updated_by)
        VALUES (${brandName}, ${by}, ${by}) ON CONFLICT DO NOTHING`;
      const brand = await tx.$queryRaw<IdRow[]>`
        SELECT brand_id AS id FROM oem.brands
        WHERE lower(btrim(brand_name)) = lower(btrim(${brandName})) LIMIT 1`;
      await tx.$executeRaw`
        INSERT INTO oem.categories (category_name, created_by, updated_by)
        VALUES (${categoryName}, ${by}, ${by}) ON CONFLICT DO NOTHING`;
      const category = await tx.$queryRaw<IdRow[]>`
        SELECT category_id AS id FROM oem.categories
        WHERE lower(btrim(category_name)) = lower(btrim(${categoryName})) LIMIT 1`;
      if (!brand[0] || !category[0]) throw new ConflictException('Could not register brand or category');
      const brandId = brand[0].id, categoryId = category[0].id;

      let selectedMaterialId = materialId;
      if (selectedMaterialId) {
        const matched = await tx.$queryRaw<Array<{ material_id: string; unit: string }>>`
          SELECT material_id, unit FROM oem.materials
          WHERE material_id = ${selectedMaterialId}::uuid AND brand_id = ${brandId}::uuid
            AND category_id = ${categoryId}::uuid
            AND lower(btrim(material_name)) = lower(btrim(${materialName})) FOR UPDATE`;
        if (!matched[0]) throw new BadRequestException('Selected material does not match brand/category/name');
        if (matched[0].unit !== unit) throw new BadRequestException(`Existing material unit is ${matched[0].unit}`);
      } else {
        const inserted = await tx.$queryRaw<IdRow[]>`
          INSERT INTO oem.materials
            (brand_id, category_id, material_name, unit, created_by, updated_by)
          VALUES (${brandId}::uuid, ${categoryId}::uuid, ${materialName}, ${unit}, ${by}, ${by})
          ON CONFLICT DO NOTHING RETURNING material_id AS id`;
        if (!inserted[0]) {
          throw new ConflictException('Material already registered. Select it from the existing material dropdown to add another pack size.');
        }
        selectedMaterialId = inserted[0].id;
      }
      const pack = await tx.$queryRaw<IdRow[]>`
        INSERT INTO oem.material_packs
          (material_id, pack_size, created_by, updated_by)
        VALUES (${selectedMaterialId}::uuid, ${packSize}, ${by}, ${by})
        ON CONFLICT DO NOTHING RETURNING pack_id AS id`;
      if (!pack[0]) throw new ConflictException('That pack size is already registered for this material');
      return { materialId: selectedMaterialId, packId: pack[0].id, packSize, unit };
    });
  }

  async addProject(body: Record<string, unknown>, actor?: string) {
    const projectName = name(body.projectName, 'OEM project', 200);
    const by = actor?.slice(0, 200) || null;
    const inserted = await this.prisma.$queryRaw<Array<{ projectId: string; projectName: string }>>`
      INSERT INTO oem.projects (project_name, created_by, updated_by)
      VALUES (${projectName}, ${by}, ${by})
      ON CONFLICT DO NOTHING
      RETURNING project_id AS "projectId", project_name AS "projectName"`;
    if (!inserted[0]) throw new ConflictException('OEM project already exists. Select it from the dropdown.');
    return inserted[0];
  }

  async listQuotations(pageInput?: string, projectInput?: string) {
    const page = pageInput == null ? 1 : Number(pageInput);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) {
      throw new BadRequestException('Invalid page');
    }
    const projectId = projectInput ? id(projectInput, 'OEM project ID') : null;
    const pageSize = 25;
    const offset = (page - 1) * pageSize;
    const [items, totals] = await Promise.all([
      this.prisma.$queryRaw<Array<{
        quotationId: string; quotationDate: string; projectId: string; projectName: string;
        lineCount: number; updatedAt: string; createdBy: string | null; updatedBy: string | null;
      }>>`
        SELECT q.quotation_id AS "quotationId", to_char(q.quotation_date, 'YYYY-MM-DD') AS "quotationDate",
          q.project_id AS "projectId", p.project_name AS "projectName",
          (SELECT count(*)::integer FROM oem.quotation_lines l WHERE l.quotation_id = q.quotation_id) AS "lineCount",
          q.updated_at AS "updatedAt", q.created_by AS "createdBy", q.updated_by AS "updatedBy"
        FROM oem.quotations q JOIN oem.projects p ON p.project_id = q.project_id
        WHERE (${projectId}::uuid IS NULL OR q.project_id = ${projectId}::uuid)
        ORDER BY q.quotation_date DESC, q.quotation_id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<CountRow[]>`
        SELECT count(*) AS count FROM oem.quotations q
        WHERE (${projectId}::uuid IS NULL OR q.project_id = ${projectId}::uuid)`,
    ]);
    return { items, page, pageSize, total: Number(totals[0]?.count ?? 0) };
  }

  async getQuotation(quotationId: string) {
    if (!/^Q\d{4,}$/.test(quotationId)) throw new BadRequestException('Invalid quotation ID');
    const headers = await this.prisma.$queryRaw<Array<{
      quotationId: string; projectId: string; projectName: string; quotationDate: string;
      createdAt: Date; updatedAt: Date; createdBy: string | null; updatedBy: string | null;
    }>>`
      SELECT q.quotation_id AS "quotationId", q.project_id AS "projectId",
        p.project_name AS "projectName", to_char(q.quotation_date, 'YYYY-MM-DD') AS "quotationDate",
        q.created_at AS "createdAt", q.updated_at AS "updatedAt",
        q.created_by AS "createdBy", q.updated_by AS "updatedBy"
      FROM oem.quotations q JOIN oem.projects p ON p.project_id = q.project_id
      WHERE q.quotation_id = ${quotationId}`;
    if (!headers[0]) throw new NotFoundException('Quotation not found');
    const quoteLines = await this.prisma.$queryRaw<Array<{
      lineId: string; lineNo: number; packId: string; materialName: string;
      brandName: string; categoryName: string; packSize: number; unit: string;
      packPrice: number; coverage: number; remark: string | null;
      perUnitRate: number; createdAt: Date; updatedAt: Date;
      createdBy: string | null; updatedBy: string | null;
    }>>`
      SELECT l.line_id AS "lineId", l.line_no AS "lineNo", l.pack_id AS "packId",
        m.material_name AS "materialName", b.brand_name AS "brandName",
        c.category_name AS "categoryName", pk.pack_size::float8 AS "packSize", m.unit,
        l.pack_price::float8 AS "packPrice", l.coverage_sft_per_unit::float8 AS coverage,
        l.remark, (l.pack_price / pk.pack_size)::float8 AS "perUnitRate",
        l.created_at AS "createdAt", l.updated_at AS "updatedAt",
        l.created_by AS "createdBy", l.updated_by AS "updatedBy"
      FROM oem.quotation_lines l JOIN oem.material_packs pk ON pk.pack_id = l.pack_id
      JOIN oem.materials m ON m.material_id = pk.material_id
      JOIN oem.brands b ON b.brand_id = m.brand_id
      JOIN oem.categories c ON c.category_id = m.category_id
      WHERE l.quotation_id = ${quotationId} ORDER BY l.line_no`;
    return { ...headers[0], lines: quoteLines };
  }

  async saveQuotation(quotationId: string | null, body: Record<string, unknown>, actor?: string) {
    if (quotationId != null && !/^Q\d{4,}$/.test(quotationId)) {
      throw new BadRequestException('Invalid quotation ID');
    }
    const projectId = id(body.projectId, 'OEM project ID');
    const quoteDate = date(body.quotationDate);
    const submittedLines = lines(body.lines);
    const by = actor?.slice(0, 200) || null;
    const json = JSON.stringify(submittedLines);
    const resultId = await this.prisma.$transaction(async tx => {
      const projects = await tx.$queryRaw<IdRow[]>`
        SELECT project_id AS id FROM oem.projects WHERE project_id = ${projectId}::uuid`;
      if (!projects[0]) throw new BadRequestException('Select an existing OEM project');
      const packCounts = await tx.$queryRaw<CountRow[]>`
        SELECT count(*) AS count FROM oem.material_packs
        WHERE pack_id IN (SELECT (x->>'packId')::uuid
          FROM jsonb_array_elements(${json}::jsonb) x)`;
      if (Number(packCounts[0]?.count ?? 0) !== submittedLines.length) {
        throw new BadRequestException('One or more selected material packs no longer exist');
      }
      let qid = quotationId;
      if (!qid) {
        const inserted = await tx.$queryRaw<Array<{ quotationId: string }>>`
          INSERT INTO oem.quotations (project_id, quotation_date, created_by, updated_by)
          VALUES (${projectId}::uuid, ${quoteDate}::date, ${by}, ${by})
          RETURNING quotation_id AS "quotationId"`;
        qid = inserted[0]?.quotationId;
      } else {
        const updated = await tx.$queryRaw<Array<{ quotationId: string }>>`
          UPDATE oem.quotations SET project_id=${projectId}::uuid,
            quotation_date=${quoteDate}::date, updated_by=${by}
          WHERE quotation_id=${qid}
          RETURNING quotation_id AS "quotationId"`;
        if (!updated[0]) throw new NotFoundException('Quotation not found');
        // Give existing lines temporary positive positions to avoid collisions
        // when a user reorders rows; UPSERT retains their original audit fields.
        await tx.$executeRaw`
          UPDATE oem.quotation_lines SET line_no = line_no + 1000000,
            updated_by = ${by}
          WHERE quotation_id = ${qid}`;
      }
      if (!qid) throw new ConflictException('Unable to create quotation');
      await tx.$executeRaw`
        INSERT INTO oem.quotation_lines
          (quotation_id, line_no, pack_id, pack_price, coverage_sft_per_unit,
           remark, created_by, updated_by)
        SELECT ${qid}, x.ordinality::integer, (x.item->>'packId')::uuid,
          (x.item->>'packPrice')::numeric, (x.item->>'coverage')::numeric,
          x.item->>'remark', ${by}, ${by}
        FROM jsonb_array_elements(${json}::jsonb) WITH ORDINALITY x(item, ordinality)
        ON CONFLICT (quotation_id, pack_id) DO UPDATE
          SET line_no=excluded.line_no, pack_price=excluded.pack_price,
            coverage_sft_per_unit=excluded.coverage_sft_per_unit,
            remark=excluded.remark, updated_by=excluded.updated_by`;
      if (quotationId) {
        await tx.$executeRaw`
          DELETE FROM oem.quotation_lines l
          WHERE l.quotation_id=${qid}
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(${json}::jsonb) x
              WHERE (x->>'packId')::uuid=l.pack_id
            )`;
      }
      return qid;
    }, { timeout: 20000 });
    return this.getQuotation(resultId);
  }
}