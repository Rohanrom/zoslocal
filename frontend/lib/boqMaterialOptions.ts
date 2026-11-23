import type { BoqMaterial } from './preContractBoqApi';

/** Normalize presentation-only material names. Keep original source IDs for saving. */
export function materialNameKey(name: string | null | undefined): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export type BoqMaterialNameOption = {
  key: string;
  name: string;
  sources: BoqMaterial[];
  /** Same material name may have different rate/coverage snapshots by site. */
  hasDifferentPricing: boolean;
};

/**
 * Show a material name once while retaining all original Material Master records.
 * Never merge rates or coverage: the selected materialId must still identify one
 * actual active Material Master record for the existing backend endpoints.
 */
export function groupBoqMaterialsByName(materials: BoqMaterial[]): BoqMaterialNameOption[] {
  const groups = new Map<string, BoqMaterial[]>();
  for (const material of materials) {
    const key = materialNameKey(material.materialName);
    if (!key) continue;
    const entries = groups.get(key) ?? [];
    entries.push(material);
    groups.set(key, entries);
  }

  const completeness = (m: BoqMaterial) => Number(m.rate != null) + Number(m.coverage != null);
  return [...groups.entries()].map(([key, items]) => {
    const sources = [...items].sort((a, b) =>
      completeness(b) - completeness(a) ||
      a.sourceProjectId.localeCompare(b.sourceProjectId) ||
      String(a.application ?? '').localeCompare(String(b.application ?? '')) ||
      String(a.workLayer ?? '').localeCompare(String(b.workLayer ?? '')) ||
      a.materialId.localeCompare(b.materialId)
    );
    const first = sources[0];
    const hasDifferentPricing = sources.some(source =>
      source.rate !== first.rate || source.coverage !== first.coverage
    );
    return { key, name: first.materialName.trim().replace(/\s+/g, ' '), sources, hasDifferentPricing };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Label only for secondary source selection, not for the unique-name dropdown. */
export function materialSourceLabel(material: BoqMaterial): string {
  const context = [material.application, material.workLayer].filter(Boolean).join(' / ');
  return `${material.sourceProjectId}${context ? ` · ${context}` : ''} · ₹${material.rate ?? '—'} · ${material.coverage ?? '—'} sqft/unit`;
}