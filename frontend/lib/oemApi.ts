const BASE = `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000'}/oem`;

export type OemBrand = { brandId: string; brandName: string };
export type OemCategory = { categoryId: string; categoryName: string };
export type OemProject = { projectId: string; projectName: string };
export type OemMasterData = {
  brands: OemBrand[];
  categories: OemCategory[];
  projects: OemProject[];
};
export type OemPack = { packId: string; packSize: number };
export type OemMaterial = {
  materialId: string;
  brandId: string;
  brandName: string;
  categoryId: string;
  categoryName: string;
  materialName: string;
  unit: 'KG' | 'L' | 'Piece';
  packs: OemPack[];
};
export type NewOemMaterial = {
  brandName: string;
  categoryName: string;
  materialName: string;
  materialId?: string;
  packSize: number;
  unit: OemMaterial['unit'];
};
export type QuotationLineInput = { packId: string; packPrice: number; coverage: number; remark: string };
export type QuotationInput = { projectId: string; quotationDate: string; lines: QuotationLineInput[] };
export type OemQuotationSummary = {
  quotationId: string;
  quotationDate: string;
  projectId: string;
  projectName: string;
  lineCount: number;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
};
export type OemQuotationLine = {
  lineId: string;
  lineNo: number;
  packId: string;
  materialName: string;
  brandName: string;
  categoryName: string;
  packSize: number;
  unit: string;
  packPrice: number;
  coverage: number;
  perUnitRate: number;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
};
export type OemQuotation = {
  quotationId: string;
  projectId: string;
  projectName: string;
  quotationDate: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  lines: OemQuotationLine[];
};

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data as { message?: string | string[] };
    throw new Error(Array.isArray(details.message) ? details.message.join(', ') :
      details.message || `OEM request failed (${response.status})`);
  }
  return data as T;
}
const json = (body: object) => JSON.stringify(body);
export const oemApi = {
  masterData: (token: string) => request<OemMasterData>(token, '/master-data'),
  materials: (token: string) => request<OemMaterial[]>(token, '/materials'),
  registerMaterial: (token: string, input: NewOemMaterial) => request<{ materialId: string; packId: string }>(
    token, '/materials', { method: 'POST', body: json(input) }),
  addProject: (token: string, projectName: string) => request<OemProject>(
    token, '/projects', { method: 'POST', body: json({ projectName }) }),
  quotations: (token: string, page = 1, projectId?: string) => request<{
    items: OemQuotationSummary[]; total: number; page: number; pageSize: number;
  }>(token, `/quotations?page=${page}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`),
  quotation: (token: string, id: string) => request<OemQuotation>(token, `/quotations/${encodeURIComponent(id)}`),
  createQuotation: (token: string, input: QuotationInput) => request<OemQuotation>(
    token, '/quotations', { method: 'POST', body: json(input) }),
  updateQuotation: (token: string, id: string, input: QuotationInput) => request<OemQuotation>(
    token, `/quotations/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(input) }),
};