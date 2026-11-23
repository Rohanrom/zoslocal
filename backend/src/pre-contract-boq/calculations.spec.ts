
import { describe, expect, it } from '@jest/globals';
import {
  calculateLayer,
  calculateProject,
  distributeRevenue,
  LayerInput,
  targetRevenue,
} from './calculations';

const layer = (
  id: string,
  billable: boolean,
  costPerDay: number,
  area = 1000,
): LayerInput => ({
  project_id: 'boq_test',
  layer_id: id,
  application: 'FLAT-A',
  work_layer: id,
  surface: 'Wall',
  area,
  billable,
  area_percentage: 100,
  productivity: 100,
  per_labor_cost: costPerDay,
  material_id: null,
  material_source_project_id: null,
  material_name: null,
  material_rate: null,
  material_coverage: null,
  revenue_amount: 0,
  source: 'import',
  sort_order: 1,
});

describe('Pre-Contract BOQ costing and commercial editing', () => {
  it('uses only 20% effective area for touchup even if made billable', () => {
    const test = {
      ...layer('Touchup', true, 800, 100000),
      area_percentage: 20,
    };

    const calc = calculateLayer(test);

    expect(calc.effectiveArea).toBe(20000);
    expect(calc.labourHours).toBe(1600);
    expect(calc.labourDays).toBe(200);
    expect(calc.labourCost).toBe(160000);
    expect(calc.clientRate).toBe(0);
  });

  it('includes nonbillable and consumables costs in application target margin', () => {
    const rows = [
      layer('primer', true, 400),
      layer('paint', true, 600),
      layer('sanding', false, 200),
    ];

    const apps = [
      {
        application: 'FLAT-A',
        consumables_cost: 1000,
      },
    ];

    const initial = calculateProject(rows, apps).applications[0];

    expect(initial.totalCost).toBe(13000);

    const desired = targetRevenue(
      'margin',
      25,
      initial.totalCost,
      initial.billableArea,
    );

    const allocations = distributeRevenue(
      initial.layers,
      desired,
    );

    expect(allocations.length).toBe(2);

    // Direct billable costs are 4000 vs 6000.
    // Revenue distribution should follow a 40/60 split.

    expect(
      allocations[0].revenue / desired,
    ).toBeCloseTo(0.4, 3);

    expect(
      allocations[1].revenue / desired,
    ).toBeCloseTo(0.6, 3);

    const revised = rows.map((row) => ({
      ...row,
      revenue_amount:
        allocations.find(
          (item) => item.layerId === row.layer_id,
        )?.revenue ?? 0,
    }));

    const allocated = calculateProject(
      revised,
      apps,
    ).applications[0];

    expect(allocated.profitMargin).toBeCloseTo(25, 2);

    expect(
      allocated.layers.find(
        (item) => item.layer_id === 'sanding',
      )?.revenue,
    ).toBe(0);
  });

  it('rolls up effective work area, labour hours and labour days across application layers', () => {
    const rows = [
      layer('primer', true, 400, 1000),
      {
        ...layer('touchup', false, 400, 1000),
        area_percentage: 20,
      },
    ];

    const app = calculateProject(
      rows,
      [
        {
          application: 'FLAT-A',
          consumables_cost: 100,
        },
      ],
    ).applications[0];

    expect(app.effectiveWorkArea).toBe(1200);
    expect(app.labourDays).toBe(12);
    expect(app.labourHours).toBe(96);
    expect(app.billableArea).toBe(1000);
  });

  it('supports editing revenue, profit and client rate in reverse', () => {
    expect(
      targetRevenue('revenue', 20000, 13000, 2000),
    ).toBe(20000);

    expect(
      targetRevenue('profit', 7000, 13000, 2000),
    ).toBe(20000);

    expect(
      targetRevenue('rate', 10, 13000, 2000),
    ).toBe(20000);

    expect(() =>
      targetRevenue('margin', 100, 13000, 2000),
    ).toThrow();
  });
});
