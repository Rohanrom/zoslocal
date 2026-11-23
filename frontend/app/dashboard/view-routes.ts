// Maps each project view to its own address, so a view can be refreshed,
// bookmarked, shared and reached with the browser's Back button.
//
//   home                      → /projects/<projectId>/overview
//   layers / flats            → /projects/<projectId>/layers | /flats
//   dimensions                → /projects/<projectId>/dimensions
//   work-order-worksheet      → /projects/<projectId>/work-order
//   billing-<name>            → /projects/<projectId>/billing/<name>
//   assignment-<name>         → /projects/<projectId>/assignment/<name>

import {
  ASSIGNMENT_VIEW_IDS,
  BILLING_VIEW_IDS,
  type AssignmentViewId,
  type BillingViewId,
} from './view-titles';

export type ProjectViewId =
  | 'home'
  | 'layers'
  | 'flats'
  | 'dimensions'
  | 'work-order-worksheet'
  | BillingViewId
  | AssignmentViewId;

export const DEFAULT_PROJECT_VIEW: ProjectViewId = 'home';

const SIMPLE_PATHS: Record<string, ProjectViewId> = {
  overview: 'home',
  layers: 'layers',
  flats: 'flats',
  dimensions: 'dimensions',
  'work-order': 'work-order-worksheet',
};

const SIMPLE_VIEW_TO_PATH: Record<string, string> = Object.fromEntries(
  Object.entries(SIMPLE_PATHS).map(([path, view]) => [view, path]),
);

/** The path part after /projects/<projectId>/ for a view. */
export function viewToPath(view: ProjectViewId): string {
  if (view in SIMPLE_VIEW_TO_PATH) return SIMPLE_VIEW_TO_PATH[view];
  if (view.startsWith('billing-')) return `billing/${view.slice('billing-'.length)}`;
  if (view.startsWith('assignment-')) return `assignment/${view.slice('assignment-'.length)}`;
  return SIMPLE_VIEW_TO_PATH[DEFAULT_PROJECT_VIEW];
}

/** Reads the view from the path segments after /projects/<projectId>/. Unknown paths give the default view. */
export function viewFromSegments(segments: string[]): ProjectViewId {
  const [first = '', second = ''] = segments.map((part) => decodeURIComponent(part).toLowerCase());

  if (first in SIMPLE_PATHS && !second) return SIMPLE_PATHS[first];

  if (first === 'billing') {
    const id = `billing-${second}` as BillingViewId;
    return BILLING_VIEW_IDS.includes(id) ? id : DEFAULT_PROJECT_VIEW;
  }

  if (first === 'assignment') {
    const id = `assignment-${second}` as AssignmentViewId;
    return ASSIGNMENT_VIEW_IDS.includes(id) ? id : DEFAULT_PROJECT_VIEW;
  }

  return DEFAULT_PROJECT_VIEW;
}

/** Full address of a view inside a project. */
export function projectViewHref(projectId: string, view: ProjectViewId = DEFAULT_PROJECT_VIEW): string {
  return `/projects/${encodeURIComponent(projectId)}/${viewToPath(view)}`;
}

/** Splits a pathname like /projects/abc/billing/pending into its project id and view. */
export function parseProjectPath(pathname: string): { projectId: string; view: ProjectViewId } | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'projects' || !parts[1]) return null;
  return {
    projectId: decodeURIComponent(parts[1]),
    view: viewFromSegments(parts.slice(2)),
  };
}
