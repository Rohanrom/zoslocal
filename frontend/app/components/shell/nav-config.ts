// Navigation structure of ZOS: hubs on the global rail, and the modules of a
// project grouped by stage of work. Every menu, breadcrumb, tab bar and the
// Ctrl K palette is built from this one file, so they never disagree.
// See docs: "ZOS UX Architecture", sections 4 and 5.

import {
  ASSIGNMENT_VIEW_IDS,
  BILLING_VIEW_IDS,
  getAssignmentViewTitle,
  getBillingViewTitle,
} from '../../dashboard/view-titles';
import { projectViewHref, type ProjectViewId } from '../../dashboard/view-routes';

export type HubId = 'home' | 'projects' | 'estimation' | 'analytics' | 'masters' | 'admin';

export type Hub = {
  id: HubId;
  label: string;
  href: string;
  /** Path prefixes that belong to this hub. The longest match wins. */
  matches: string[];
  /** Roles that see this hub. */
  roles: string[];
};

export const HUBS: Hub[] = [
  { id: 'home', label: 'Home', href: '/home', matches: ['/home'], roles: ['admin', 'viewer'] },
  { id: 'projects', label: 'Projects', href: '/projects', matches: ['/projects', '/dashboard'], roles: ['admin', 'viewer', 'manager'] },
  { id: 'estimation', label: 'Estimation', href: '/pre-contract-boq', matches: ['/pre-contract-boq', '/estimation', '/oem/quotations'], roles: ['admin', 'viewer'] },
  { id: 'analytics', label: 'Analytics', href: '/analytics', matches: ['/analytics'], roles: ['admin', 'viewer'] },
  { id: 'masters', label: 'Masters', href: '/oem', matches: ['/oem', '/masters'], roles: ['admin', 'viewer'] },
  { id: 'admin', label: 'Admin', href: '/admin/project-setup', matches: ['/admin'], roles: ['admin'] },
];

export function hubsForRole(role: string): Hub[] {
  return HUBS.filter((hub) => hub.roles.includes(role));
}

export function activeHubFor(pathname: string): Hub | null {
  let best: Hub | null = null;
  let bestLength = -1;
  for (const hub of HUBS) {
    for (const prefix of hub.matches) {
      const hit = pathname === prefix || pathname.startsWith(`${prefix}/`);
      if (hit && prefix.length > bestLength) {
        best = hub;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

/** Pages of the company-level hubs, shown in the context sidebar. */
export const HUB_PAGES: Partial<Record<HubId, { label: string; href: string }[]>> = {
  estimation: [
    { label: 'Estimates', href: '/pre-contract-boq' },
    { label: 'Brand comparison', href: '/oem/quotations' },
  ],
  masters: [{ label: 'Materials', href: '/oem' }],
  admin: [
    { label: 'Project setup', href: '/admin/project-setup' },
    { label: 'Users and roles', href: '/admin/users' },
  ],
};

// ---------------------------------------------------------------------------
// Project modules

export type Capability = 'assignment' | 'billing';

export type ProjectModule = {
  key: string;
  label: string;
  /** Views of this module, in tab order. Empty for modules that link out. */
  views: ProjectViewId[];
  /** For modules that live in another hub (Analytics). */
  externalHref?: (projectId: string) => string;
  /** Shown with a "Set up" tag when the project lacks this capability. */
  capability?: Capability;
};

export type ProjectGroup = { label: string; modules: ProjectModule[] };

const PROJECTION_LABELS: Partial<Record<ProjectViewId, string>> = {
  flats: 'Flat progress',
  layers: 'Projection summary',
};

export const PROJECT_GROUPS: ProjectGroup[] = [
  {
    label: 'Scope',
    modules: [
      { key: 'overview', label: 'Overview', views: ['home'] },
      { key: 'dimensions', label: 'Dimensions', views: ['dimensions'] },
      { key: 'work-order', label: 'BOQ & work order', views: ['work-order-worksheet'] },
    ],
  },
  {
    label: 'Plan',
    modules: [{ key: 'projection', label: 'Projection', views: ['flats', 'layers'] }],
  },
  {
    label: 'Execute',
    modules: [{ key: 'assignment', label: 'Assignment', views: ASSIGNMENT_VIEW_IDS, capability: 'assignment' }],
  },
  {
    label: 'Commercial',
    modules: [
      {
        key: 'billing',
        label: 'Billing',
        // The batch view is reached from inside Billing, not as its own tab.
        views: BILLING_VIEW_IDS.filter((view) => view !== 'billing-batch-view'),
        capability: 'billing',
      },
    ],
  },
  {
    label: 'Insights',
    modules: [
      {
        key: 'analytics',
        label: 'Analytics',
        views: [],
        externalHref: (projectId) => `/analytics?projectId=${encodeURIComponent(projectId)}`,
      },
    ],
  },
];

/** Planned modules, listed once under "In development" instead of as empty pages. */
export const IN_DEVELOPMENT = ['Material', 'QC (ZQS)', 'PaintLine', 'BrushLine', 'Pods', 'Deployment', 'Governance'];

/** Project managers see only these views (same rule as the backend workspace). */
export const MANAGER_VIEWS: ProjectViewId[] = ['assignment-final', 'assignment-reporting', 'assignment-layer-progress'];
export const MANAGER_PROJECT_ID = 'indradhanush';

export function projectGroupsForRole(role: string): ProjectGroup[] {
  if (role !== 'manager') return PROJECT_GROUPS;
  return [
    {
      label: 'Execute',
      modules: [{ key: 'assignment', label: 'Assignment', views: MANAGER_VIEWS }],
    },
  ];
}

export function moduleForView(view: ProjectViewId, role: string): ProjectModule | null {
  for (const group of projectGroupsForRole(role)) {
    for (const mod of group.modules) {
      if (mod.views.includes(view)) return mod;
    }
  }
  return null;
}

export function viewLabel(view: ProjectViewId): string {
  if (view.startsWith('assignment-')) return getAssignmentViewTitle(view as never);
  if (view.startsWith('billing-')) return getBillingViewTitle(view as never);
  if (PROJECTION_LABELS[view]) return PROJECTION_LABELS[view] as string;
  for (const group of PROJECT_GROUPS) {
    for (const mod of group.modules) {
      if (mod.views.length === 1 && mod.views[0] === view) return mod.label;
    }
  }
  return 'Overview';
}

export function moduleHref(mod: ProjectModule, projectId: string): string {
  if (mod.externalHref) return mod.externalHref(projectId);
  return projectViewHref(projectId, mod.views[0]);
}
