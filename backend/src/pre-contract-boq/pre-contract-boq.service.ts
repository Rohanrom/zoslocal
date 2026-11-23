import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApplicationInput, calculateProject, distributeRevenue, LayerInput,
  PricingField, targetRevenue,
} from './calculations';

type Db = Pick<PrismaService, '$queryRaw' | '$executeRaw'>;
type ProjectRow = {
  project_id: string; project_name: string; created_at: Date; updated_at: Date;
};
type MaterialRow = {
  material_id: string; project_id: string; material_name: string;
  application: string | null; work_layer: string | null;
  coverage: unknown; unit_cost: unknown;
};
type ImportedLayer = {
  application: string; work_layer: string; surface: 'Ceiling'|'Wall'|'Both';
  area: number; billable: boolean; area_percentage: number;
  productivity: number|null; per_labor_cost: number|null;
  sort_order: number;
};

function normalizeName(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new BadRequestException(`${label} must be a non-empty string (max ${max} characters)`);
  }
  return value.trim();
}
function nonNegative(value: unknown, field: string): number {
  const n = typeof value === 'string' && !value.trim() ? NaN : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1e13) {
    throw new BadRequestException(`${field} must be a non-negative number`);
  }
  return n;
}
function optionalNumber(value: unknown, field: string, strictlyPositive = false): number|null {
  if (value === undefined || value === null || value === '') return null;
  const n = nonNegative(value, field);
  if (strictlyPositive && n === 0) throw new BadRequestException(`${field} must be greater than zero`);
  return n;
}
function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const s = String(value ?? '').trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  throw new BadRequestException('Billable must be TRUE or FALSE');
}
function surface(value: unknown): 'Ceiling'|'Wall'|'Both' {
  const s = String(value ?? '').trim().toLowerCase();
  if (s === 'ceiling') return 'Ceiling';
  if (s === 'wall' || s === 'walls') return 'Wall';
  if (s === 'both') return 'Both';
  throw new BadRequestException('Surface must be Ceiling, Wall or Both');
}
function percent(value: unknown): number {
  const v = String(value ?? '').trim().replace(/%$/, '').trim();
  const n = nonNegative(v, 'Percentage of Area');
  if (n > 100) throw new BadRequestException('Percentage of Area cannot exceed 100%');
  return n;
}

function parseRemark(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException('Remark must be text');
  if (value.length > 1000) throw new BadRequestException('Remark cannot exceed 1000 characters');
  return value.trim() || null;
}

function selectedNames(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 500) {
    throw new BadRequestException(`${field} must contain 1 to 500 selected names`);
  }
  return [...new Set(value.map(item => normalizeName(item, field)))];
}

function validMaterialId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException('Select a valid material from the Material Master');
  }
  return value;
}

function scenarioPercent(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n) || n < -90 || n > 200) {
    throw new BadRequestException(`${name} must be between -90% and +200%`);
  }
  return n;
}

/** Support UTF-8 BOM, commas, CRLF and quoted multiline fields without another dependency. */
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [], cell = '', quoted = false;
  const text = content.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i+1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') {
      if (cell.length) throw new BadRequestException('Malformed CSV quoting');
      quoted = true;
    } else if (c === ',') { current.push(cell); cell=''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i+1] === '\n') i++;
      current.push(cell); cell='';
      if (current.some(v=>v.trim())) rows.push(current);
      current=[];
    } else cell+=c;
  }
  if (quoted) throw new BadRequestException('Unclosed quoted CSV field');
  current.push(cell);
  if (current.some(v=>v.trim())) rows.push(current);
  return rows;
}
function readImport(content: string): ImportedLayer[] {
  const rows = parseCsv(content);
  if (rows.length < 2) throw new BadRequestException('CSV must have a header and at least one layer');
  const key = (s: string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
  const names = rows[0].map(key);
  const cols = [
    'Application','Work Layer','Surface','Area','Billable','Percentage of Area','Productivity','Per Labor Cost',
  ];
  const idx = cols.map(col=>names.indexOf(key(col)));
  if (idx.some(i=>i<0)) {
    throw new BadRequestException(`Missing CSV columns: ${cols.filter((_,i)=>idx[i]<0).join(', ')}`);
  }
  if (rows.length > 25001) throw new BadRequestException('Maximum 25,000 layers per CSV');
  return rows.slice(1).map((r,i)=>{
    const get = (j: number)=>r[idx[j]] ?? '';
    try {
      return {
        application: normalizeName(get(0),'Application'),
        work_layer: normalizeName(get(1),'Work Layer'),
        surface: surface(get(2)), area: nonNegative(get(3),'Area'),
        billable: parseBoolean(get(4)), area_percentage: percent(get(5)),
        productivity: optionalNumber(get(6),'Productivity',true),
        per_labor_cost: optionalNumber(get(7),'Per Labor Cost'),
        sort_order: i+1,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw new BadRequestException(`CSV row ${i+2}: ${error.message}`);
      throw error;
    }
  });
}

@Injectable()
export class PreContractBoqService {
  constructor(private readonly prisma: PrismaService) {}

  private projectId(projectId: string) {
    if (!/^boq_[a-z0-9_]+$/.test(projectId || '')) throw new BadRequestException('Invalid BOQ project ID');
    return projectId;
  }
  private async project(db: Db, projectId: string): Promise<ProjectRow> {
    const id = this.projectId(projectId);
    const rows = await db.$queryRaw<ProjectRow[]>`
      select project_id, project_name, created_at, updated_at
      from pre_contract_boq.projects where project_id = ${id}
    `;
    if (!rows.length) throw new NotFoundException('Pre-Contract BOQ project not found');
    return rows[0];
  }
  private async lockProject(db: Db, projectId: string) {
    const id = this.projectId(projectId);
    const rows = await db.$queryRaw<ProjectRow[]>`
      select project_id, project_name, created_at, updated_at
      from pre_contract_boq.projects where project_id = ${id} for update
    `;
    if (!rows.length) throw new NotFoundException('Pre-Contract BOQ project not found');
    return rows[0];
  }
  private async state(db: Db, id: string) {
    const [apps, layers] = await Promise.all([
      db.$queryRaw<ApplicationInput[]>`
        select application, consumables_cost
        from pre_contract_boq.applications where project_id = ${id} order by application
      `,
      db.$queryRaw<LayerInput[]>`
        select project_id, layer_id::text as layer_id, application, work_layer, surface,
               area, billable, area_percentage, productivity, per_labor_cost,
               material_id::text as material_id, material_source_project_id, material_name,
               material_rate, material_coverage, revenue_amount, source, sort_order, remark
        from pre_contract_boq.boq_layers where project_id = ${id}
        order by application, sort_order, created_at, layer_id
      `,
    ]);
    return calculateProject(layers, apps);
  }
  private async touch(db: Db, id: string) {
    await db.$executeRaw`update pre_contract_boq.projects set updated_at = now() where project_id = ${id}`;
  }
  private async ensureApp(db: Db, id: string, application: string) {
    await db.$executeRaw`
      insert into pre_contract_boq.applications (project_id, application)
      values (${id}, ${application}) on conflict do nothing
    `;
  }
  async list() {
    const rows = await this.prisma.$queryRaw<(ProjectRow & {layer_count:bigint; application_count:bigint})[]>`
      select p.project_id,p.project_name,p.created_at,p.updated_at,
             (select count(*) from pre_contract_boq.boq_layers l where l.project_id=p.project_id) as layer_count,
             (select count(*) from pre_contract_boq.applications a where a.project_id=p.project_id) as application_count
      from pre_contract_boq.projects p order by p.updated_at desc
    `;
    return rows.map(r=>({projectId:r.project_id,projectName:r.project_name,createdAt:r.created_at,
      updatedAt:r.updated_at,layerCount:Number(r.layer_count),applicationCount:Number(r.application_count)}));
  }
  async create(payload: Record<string,unknown>, username?: string) {
    const name = normalizeName(payload.projectName,'Project name');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,45)||'project';
    const id = `boq_${slug}_${randomBytes(5).toString('hex')}`;
    const [row] = await this.prisma.$queryRaw<ProjectRow[]>`
      insert into pre_contract_boq.projects(project_id,project_name,created_by)
      values (${id},${name},${username || null})
      returning project_id,project_name,created_at,updated_at
    `;
    return {projectId:row.project_id,projectName:row.project_name,createdAt:row.created_at};
  }
  async get(id: string) {
    const project = await this.project(this.prisma,id);
    return {projectId:project.project_id,projectName:project.project_name,
      createdAt:project.created_at,updatedAt:project.updated_at,...await this.state(this.prisma,id)};
  }
  async delete(id: string) {
    this.projectId(id);
    const affected = await this.prisma.$executeRaw`
      delete from pre_contract_boq.projects where project_id=${id}
    `;
    if (!affected) throw new NotFoundException('Pre-Contract BOQ project not found');
    return {deleted:true,projectId:id};
  }
  async materials() {
    const rows = await this.prisma.$queryRaw<MaterialRow[]>`
      select material_id::text as material_id, project_id, material_name,
             application, work_layer, coverage, unit_cost
      from indr.material_master
      where upper(trim(coalesce(status,'Active'))) = 'ACTIVE'
        and nullif(trim(material_name),'') is not null
      order by material_name,project_id,application,work_layer
    `;
    return rows.map(r=>({materialId:r.material_id,sourceProjectId:r.project_id,
      materialName:r.material_name,application:r.application,workLayer:r.work_layer,
      coverage:r.coverage == null?null:Number(r.coverage),rate:r.unit_cost==null?null:Number(r.unit_cost)}));
  }
  async importCsv(id: string, file?: {buffer?:Buffer;originalname?:string}) {
    if (!file?.buffer) throw new BadRequestException('Attach a CSV file');
    if (file.buffer.length > 5*1024*1024) throw new BadRequestException('CSV must be less than 5 MB');
    if (!file.originalname?.toLowerCase().endsWith('.csv')) throw new BadRequestException('Upload CSV format only');
    const rows = readImport(file.buffer.toString('utf8'));
    return this.prisma.$transaction(async tx=>{
      await this.lockProject(tx,id);
      // Keep manually-entered remarks only when the old and new import each
      // have exactly one row with the same application + layer + surface.
      // All imported inputs, materials, and prices are replaced as before.
      const oldRemarks = await tx.$queryRaw<{
        application:string;work_layer:string;surface:string;remark:string|null
      }[]>`
        select application, work_layer, surface, remark
        from pre_contract_boq.boq_layers
        where project_id=${id} and source='import' 
      `;
      const keyOf = (r:{application:string;work_layer:string;surface:string}) =>
        JSON.stringify([r.application,r.work_layer,r.surface]);
      const newCounts = new Map<string,number>();
      rows.forEach(r=>newCounts.set(keyOf(r),(newCounts.get(keyOf(r))||0)+1));
      const oldCounts = new Map<string,number>();
      oldRemarks.forEach(r=>oldCounts.set(keyOf(r),(oldCounts.get(keyOf(r))||0)+1));
      const noteByKey = new Map(oldRemarks.map(r=>[keyOf(r),r.remark]));
      const imported = rows.map(r=>({
        ...r,remark:newCounts.get(keyOf(r))===1 && oldCounts.get(keyOf(r))===1
          ? (noteByKey.get(keyOf(r))||null) : null,
      }));
      const removed = await tx.$executeRaw`
        delete from pre_contract_boq.boq_layers where project_id=${id} and source='import'
      `;
      for (const application of new Set(rows.map(r=>r.application))) await this.ensureApp(tx,id,application);
      // One batched SQL insert (25k rows) instead of individual round-trips.
      const json = JSON.stringify(imported);
      await tx.$executeRaw`
        insert into pre_contract_boq.boq_layers (
          project_id, application, work_layer, surface, area, billable, area_percentage,
          productivity, per_labor_cost, source, sort_order, remark
        )
        select ${id}, x.application, x.work_layer, x.surface, x.area, x.billable,
               x.area_percentage, x.productivity, x.per_labor_cost, 'import', x.sort_order, x.remark
        from jsonb_to_recordset(${json}::jsonb) as x(
          application text, work_layer text, surface text, area numeric,
          billable boolean, area_percentage numeric, productivity numeric,
          per_labor_cost numeric, sort_order bigint, remark varchar(1000)
        )
      `;
      await this.touch(tx,id);
      return {imported:rows.length,replacedImported:Number(removed),manualLayersPreserved:true,
        consumablesPreserved:true};
    },{timeout:120000});
  }
  private parseLayerInput(p: Record<string,unknown>, previous?: LayerInput): ImportedLayer {
    const application = normalizeName(p.application ?? previous?.application,'Application');
    const workLayer = normalizeName(p.workLayer ?? previous?.work_layer,'Work Layer');
    const area = nonNegative(p.area ?? previous?.area,'Area');
    const productivity = optionalNumber(p.productivity !== undefined?p.productivity:previous?.productivity,'Productivity',true);
    const perLaborCost = optionalNumber(p.perLaborCost !== undefined?p.perLaborCost:previous?.per_labor_cost,'Per Labor Cost');
    return {
      application, work_layer:workLayer, surface:surface(p.surface ?? previous?.surface), area,
      billable:parseBoolean(p.billable ?? previous?.billable ?? false),
      area_percentage:percent(p.areaPercentage ?? previous?.area_percentage ?? 100),
      productivity, per_labor_cost:perLaborCost, sort_order:previous?Number(previous.sort_order):0,
    };
  }
  async addLayer(id: string, payload: Record<string,unknown>) {
    const layer = this.parseLayerInput(payload);
    return this.prisma.$transaction(async tx=>{
      await this.lockProject(tx,id);
      await this.ensureApp(tx,id,layer.application);
      const remark = parseRemark(payload.remark);
      const [row] = await tx.$queryRaw<{layer_id:string}[]>`
        insert into pre_contract_boq.boq_layers (
          project_id,application,work_layer,surface,area,billable,area_percentage,productivity,
          per_labor_cost,source,sort_order,remark
        ) values (${id},${layer.application},${layer.work_layer},${layer.surface},${layer.area},
          ${layer.billable},${layer.area_percentage},${layer.productivity},${layer.per_labor_cost},
          'manual', (select coalesce(max(sort_order),0)+1 from pre_contract_boq.boq_layers where project_id=${id}), ${remark})
        returning layer_id::text as layer_id
      `;
      await this.touch(tx,id);
      return {layerId:row.layer_id};
    });
  }
  private layerId(layerId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(layerId || '')) {
      throw new BadRequestException('Invalid BOQ layer ID');
    }
    return layerId;
  }
  private async findLayer(db: Db,id: string,layerId: string) {
    this.layerId(layerId);
    const [row] = await db.$queryRaw<LayerInput[]>`
      select project_id, layer_id::text as layer_id, application, work_layer, surface,
             area,billable,area_percentage,productivity,per_labor_cost,
             material_id::text as material_id,material_source_project_id,material_name,
             material_rate,material_coverage,revenue_amount,source,sort_order,remark
      from pre_contract_boq.boq_layers where project_id=${id} and layer_id=${layerId}::uuid
    `;
    if (!row) throw new NotFoundException('BOQ layer not found');
    return row;
  }
  async updateLayer(id: string, layerId: string, payload:Record<string,unknown>) {
    return this.prisma.$transaction(async tx=>{
      await this.lockProject(tx,id);
      const prev = await this.findLayer(tx,id,layerId);
      const next = this.parseLayerInput(payload,prev);
      await this.ensureApp(tx,id,next.application);
      let materialId = prev.material_id;
      let sourceId = prev.material_source_project_id;
      let materialName = prev.material_name;
      let materialRate = prev.material_rate == null ? null : Number(prev.material_rate);
      let coverage = prev.material_coverage == null ? null : Number(prev.material_coverage);
      if (Object.prototype.hasOwnProperty.call(payload,'materialId')) {
        const requested = payload.materialId;
        if (requested === null || requested === '') {
          materialId=null;sourceId=null;materialName=null;materialRate=null;coverage=null;
        } else {
          if (typeof requested !== 'string' || !/^[a-f0-9-]{36}$/i.test(requested)) {
            throw new BadRequestException('Invalid material ID');
          }
          const [source] = await tx.$queryRaw<MaterialRow[]>`
            select material_id::text as material_id,project_id,material_name,
                   application,work_layer,coverage,unit_cost
            from indr.material_master
            where material_id=${requested}::uuid
              and upper(trim(coalesce(status,'Active')))='ACTIVE'
          `;
          if (!source) throw new BadRequestException('Selected Material Master record is not active');
          materialId=source.material_id;sourceId=source.project_id;materialName=source.material_name;
          materialRate=source.unit_cost==null?null:Number(source.unit_cost);
          coverage=source.coverage==null?null:Number(source.coverage);
        }
      }
      const revenue = next.billable ? Number(prev.revenue_amount) : 0;
      const remark = Object.prototype.hasOwnProperty.call(payload,'remark')
        ? parseRemark(payload.remark) : (prev.remark || null);
      await tx.$executeRaw`
        update pre_contract_boq.boq_layers set
          application=${next.application},work_layer=${next.work_layer},surface=${next.surface},
          area=${next.area},billable=${next.billable},area_percentage=${next.area_percentage},
          productivity=${next.productivity},per_labor_cost=${next.per_labor_cost},
          material_id=${materialId}::uuid,material_source_project_id=${sourceId},
          material_name=${materialName},material_rate=${materialRate},material_coverage=${coverage},
          revenue_amount=${revenue},remark=${remark},updated_at=now()
        where project_id=${id} and layer_id=${layerId}::uuid
      `;
      await this.touch(tx,id);
      return {updated:true,layerId};
    });
  }
  async deleteLayer(id: string, layerId: string) {
    this.layerId(layerId);
    return this.prisma.$transaction(async tx=>{
      await this.lockProject(tx,id);
      const affected = await tx.$executeRaw`
        delete from pre_contract_boq.boq_layers where project_id=${id} and layer_id=${layerId}::uuid
      `;
      if (!affected) throw new NotFoundException('BOQ layer not found');
      await this.touch(tx,id);
      return {deleted:true};
    });
  }
  async consumables(id: string, application: string, value:unknown) {
    const app = normalizeName(application,'Application');
    const cost = nonNegative(value,'Consumables Cost');
    return this.prisma.$transaction(async tx=>{
      await this.lockProject(tx,id);
      const count = await tx.$queryRaw<{exists:boolean}[]>`
        select exists(select 1 from pre_contract_boq.applications where project_id=${id} and application=${app}) as exists
      `;
      if (!count[0]?.exists) throw new NotFoundException('Application not found');
      await tx.$executeRaw`
        update pre_contract_boq.applications set consumables_cost=${cost},updated_at=now()
        where project_id=${id} and application=${app}
      `;
      await this.touch(tx,id);
      return {updated:true};
    });
  }
  private pricing(field:unknown,value:unknown) {
    if (!['margin','rate','revenue','profit'].includes(String(field))) {
      throw new BadRequestException('Field must be margin, rate, revenue or profit');
    }
    const numeric=Number(value);
    if (value == null || value==='' || !Number.isFinite(numeric)) {
      throw new BadRequestException('Pricing value must be a number');
    }
    return {field:field as PricingField,value:numeric};
  }
  async setLayerPricing(id: string, layerId:string, field:unknown, value:unknown) {
    const p=this.pricing(field,value);
    return this.prisma.$transaction(async tx=>{
      await this.lockProject(tx,id);
      const layer=await this.findLayer(tx,id,layerId);
      if (!layer.billable) throw new BadRequestException('Non-billable layers cannot have revenue');
      const state=await this.state(tx,id);
      const computed=state.applications.flatMap(a=>a.layers).find(r=>r.layer_id===layerId);
      if (!computed) throw new NotFoundException('Layer not found');
      let desired: number;
      try {
        desired=targetRevenue(p.field,p.value,computed.totalCost,computed.effectiveArea);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Invalid pricing value');
      }
      if (desired>0 && computed.effectiveArea===0) throw new BadRequestException('A billable layer needs positive effective area');
      await tx.$executeRaw`
        update pre_contract_boq.boq_layers set revenue_amount=${desired},updated_at=now()
        where project_id=${id} and layer_id=${layerId}::uuid
      `;
      await this.touch(tx,id);
      return {updated:true,revenue:desired};
    });
  }
  async setApplicationPricing(id:string, application:string, field:unknown,value:unknown) {
    const app=normalizeName(application,'Application');
    const p=this.pricing(field,value);
    return this.prisma.$transaction(async tx=>{
      await this.lockProject(tx,id);
      const state=await this.state(tx,id);
      const selected=state.applications.find(r=>r.application===app);
      if (!selected) throw new NotFoundException('Application not found');
      let revenue: number;
      try {
        revenue=targetRevenue(p.field,p.value,selected.totalCost,selected.billableArea);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Invalid pricing value');
      }
      let allocation:ReturnType<typeof distributeRevenue>;
      try { allocation=distributeRevenue(selected.layers.filter(r=>r.billable),revenue); }
      catch(err) { throw new BadRequestException(err instanceof Error?err.message:'Unable to allocate revenue'); }
      // Apply all allocations atomically in one SQL statement, including large BOQs.
      const allocationsJson=JSON.stringify(allocation);
      await tx.$executeRaw`
        update pre_contract_boq.boq_layers b
        set revenue_amount=x.revenue,updated_at=now()
        from jsonb_to_recordset(${allocationsJson}::jsonb) as x("layerId" text,revenue numeric)
        where b.project_id=${id} and b.layer_id=x."layerId"::uuid
      `;
      await this.touch(tx,id);
      return {updated:true,allocatedLayerCount:allocation.length,revenue};
    },{timeout:30000});
  }

  /** Assign one active source material to an exact selection of work layers and applications. */
  async bulkAssignMaterial(id:string, payload:Record<string,unknown>) {
    const materialId = validMaterialId(payload.materialId);
    const applications = selectedNames(payload.applications,'Applications');
    const workLayers = selectedNames(payload.workLayers,'Work Layers');
    const appsJson = JSON.stringify(applications);
    const layersJson = JSON.stringify(workLayers);
    return this.prisma.$transaction(async tx=>{
      await this.lockProject(tx,id);
      const [material] = await tx.$queryRaw<MaterialRow[]>`
        select material_id::text as material_id, project_id, material_name,
               application,work_layer,coverage,unit_cost
        from indr.material_master
        where material_id=${materialId}::uuid
          and upper(trim(coalesce(status,'Active')))='ACTIVE'
      `;
      if (!material) throw new BadRequestException('Selected Material Master record is not active');
      const rate = material.unit_cost == null ? null : Number(material.unit_cost);
      const coverage = material.coverage == null ? null : Number(material.coverage);
      const changed = await tx.$executeRaw`
        update pre_contract_boq.boq_layers b set
          material_id=${materialId}::uuid,
          material_source_project_id=${material.project_id},
          material_name=${material.material_name},
          material_rate=${rate},
          material_coverage=${coverage},
          updated_at=now()
        where b.project_id=${id}
          and b.application in (select jsonb_array_elements_text(${appsJson}::jsonb))
          and b.work_layer in (select jsonb_array_elements_text(${layersJson}::jsonb))
      `;
      if (changed > 0) await this.touch(tx,id);
      return {updatedLayerCount:Number(changed),materialName:material.material_name};
    },{timeout:30000});
  }

  /**
   * Save individual productivity and client-rate edits from BOQ Analysis.
   * No write occurs while previewing. At Apply, verify every row belongs to
   * the selected BOQ project, detect stale edits, then update all rows atomically.
   * Labour-day cost, material selection, material rates and coverage are untouched.
   */
  async applyLayerAnalysis(id:string, payload:Record<string,unknown>) {
    this.projectId(id);
    const input = payload.changes;
    if (!Array.isArray(input) || input.length < 1 || input.length > 25000) {
      throw new BadRequestException('Provide 1 to 25,000 layer changes');
    }
    type LayerEdit = {
      layerId:string;
      productivity?:number;
      clientRate?:number;
      expectedProductivity:number|null;
      expectedRevenueAmount:number;
    };
    const seen=new Set<string>();
    const changes:LayerEdit[]=input.map((item:unknown,index:number)=>{
      if (!item || typeof item!=='object' || Array.isArray(item)) {
        throw new BadRequestException(`Row ${index+1}: invalid layer change`);
      }
      const row=item as Record<string,unknown>;
      const layerId=this.layerId(String(row.layerId??''));
      if (seen.has(layerId)) throw new BadRequestException(`Duplicate layer ID in analysis: ${layerId}`);
      seen.add(layerId);
      if (row.productivity===undefined && row.clientRate===undefined) {
        throw new BadRequestException(`Row ${index+1}: no changes supplied`);
      }
      const change:LayerEdit={
        layerId,
        expectedProductivity:row.expectedProductivity==null ? null : optionalNumber(row.expectedProductivity,'Expected productivity',true),
        expectedRevenueAmount:(()=>{
          const amount=Number(row.expectedRevenueAmount);
          if (row.expectedRevenueAmount==null || !Number.isFinite(amount) || amount<0 || amount>1e17) {
            throw new BadRequestException('Expected revenue must be a valid non-negative amount');
          }
          return amount;
        })(),
      };
      if (row.productivity!==undefined) {
        change.productivity=optionalNumber(row.productivity,'Productivity',true) ?? undefined;
        if (change.productivity===undefined) {
          throw new BadRequestException(`Row ${index+1}: enter productivity greater than zero`);
        }
      }
      if (row.clientRate!==undefined) {
        change.clientRate=nonNegative(row.clientRate,'Client rate');
      }
      return change;
    });

    return this.prisma.$transaction(async tx=>{
      await this.lockProject(tx,id);
      const requestedIds=JSON.stringify(changes.map(change=>change.layerId));
      const records=await tx.$queryRaw<{
        layer_id:string;billable:boolean;area:unknown;area_percentage:unknown;
        productivity:unknown;revenue_amount:unknown;
      }[]>`
        select b.layer_id::text as layer_id, b.billable, b.area, b.area_percentage,
               b.productivity, b.revenue_amount
        from pre_contract_boq.boq_layers b
        where b.project_id=${id}
          and b.layer_id in (
            select value::uuid
            from jsonb_array_elements_text(${requestedIds}::jsonb) as ids(value)
          )
      `;
      const byId=new Map(records.map(r=>[r.layer_id,r]));
      const round4=(value:number)=>Math.round((value+Number.EPSILON)*10000)/10000;
      const updates:{layerId:string;productivity:number|null;revenueAmount:number}[]=[];
      for (const change of changes) {
        const row=byId.get(change.layerId);
        if (!row) throw new NotFoundException(`BOQ layer ${change.layerId} not found in this project`);
        const savedProductivity=row.productivity==null?null:Number(row.productivity);
        const savedRevenue=Number(row.revenue_amount);
        // A concurrent Costing edit must not be silently overwritten by a stale Analysis tab.
        const sameProductivity=(savedProductivity===null&&change.expectedProductivity===null)||
          (savedProductivity!==null&&change.expectedProductivity!==null&&
           Math.abs(savedProductivity-change.expectedProductivity)<0.00005);
        if (!sameProductivity||Math.abs(savedRevenue-change.expectedRevenueAmount)>=0.00005) {
          throw new ConflictException('Saved BOQ values have changed since Analysis was opened. Reload Analysis and reapply your choices.');
        }
        let revenueAmount=savedRevenue;
        if (change.clientRate!==undefined) {
          if (!row.billable) throw new BadRequestException('Cannot set a client rate on a non-billable layer');
          const effectiveArea=round4(Number(row.area)*Number(row.area_percentage)/100);
          if (effectiveArea<=0 && change.clientRate>0) {
            throw new BadRequestException('Billable layer needs positive effective area to set a client rate');
          }
          revenueAmount=round4(change.clientRate*effectiveArea);
          if (!Number.isFinite(revenueAmount)||revenueAmount>1e17) {
            throw new BadRequestException('Calculated revenue is outside the supported range');
          }
        }
        const productivity=change.productivity===undefined?savedProductivity:round4(change.productivity);
        if (productivity!==null && productivity<=0) {
          throw new BadRequestException('Productivity must be greater than zero after rounding to four decimals');
        }
        updates.push({layerId:change.layerId,productivity,revenueAmount});
      }
      const json=JSON.stringify(updates);
      const updated=await tx.$executeRaw`
        update pre_contract_boq.boq_layers b
        set productivity=x.productivity,
            revenue_amount=x."revenueAmount",
            updated_at=now()
        from jsonb_to_recordset(${json}::jsonb)
          as x("layerId" text, productivity numeric, "revenueAmount" numeric)
        where b.project_id=${id} and b.layer_id=x."layerId"::uuid
      `;
      if (Number(updated)!==updates.length) {
        throw new ConflictException('Not all selected layers could be updated; no changes were saved');
      }
      await this.touch(tx,id);
      return {updatedLayerCount:Number(updated)};
    },{timeout:30000});
  }

  /** Persist only when the user explicitly applies a simulation. No hidden writes. */
  async applyScenario(id:string,payload:Record<string,unknown>) {
    const application = payload.application == null || payload.application === 'All'
      ? null : normalizeName(payload.application,'Application');
    const labour = scenarioPercent(payload.labourRatePercent,'Labour rate change');
    const material = scenarioPercent(payload.materialRatePercent,'Material price change');
    const productivity = scenarioPercent(payload.productivityPercent,'Productivity change');
    const client = scenarioPercent(payload.clientRatePercent,'Client rate change');
    // Numeric factors match the browser preview. Negative changes never make
    // a positive productivity zero, except sub-cent precision may be rounded.
    const labourFactor = 1 + labour / 100;
    const materialFactor = 1 + material / 100;
    const productivityFactor = 1 + productivity / 100;
    const clientFactor = 1 + client / 100;
    return this.prisma.$transaction(async tx=>{
      await this.lockProject(tx,id);
      const [{count}] = await tx.$queryRaw<{count:bigint}[]>`
        select count(*)::bigint as count from pre_contract_boq.boq_layers
        where project_id=${id} and (${application}::text is null or application=${application})
      `;
      if (count === 0n) throw new BadRequestException('No BOQ layers match the chosen scope');
      const changed = await tx.$executeRaw`
        update pre_contract_boq.boq_layers set
          productivity=case when productivity is null then null
            else round(productivity*${productivityFactor}::numeric,4) end,
          per_labor_cost=case when per_labor_cost is null then null
            else round(per_labor_cost*${labourFactor}::numeric,4) end,
          material_rate=case when material_rate is null then null
            else round(material_rate*${materialFactor}::numeric,4) end,
          revenue_amount=case when billable
            then round(revenue_amount*${clientFactor}::numeric,4) else 0 end,
          updated_at=now()
        where project_id=${id} and (${application}::text is null or application=${application})
      `;
      await this.touch(tx,id);
      return {updatedLayerCount:Number(changed),application:application||'All'};
    },{timeout:30000});
  }
}