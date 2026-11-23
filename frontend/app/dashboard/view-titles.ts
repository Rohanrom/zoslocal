// View ids and titles for the dashboard's lazily loaded views.
//
// These live in their own small module so the dashboard shell can name a view
// without importing the view itself. Importing anything from
// assignment-view.tsx or billing-view.tsx would pull those large components
// into the dashboard's first download and defeat the lazy loading.

import type { BillingViewId } from '../../lib/api';

export type { BillingViewId };

export type AssignmentViewId =
  | 'assignment-demand'
  | 'assignment-recommended'
  | 'assignment-capacity'
  | 'assignment-final'
  | 'assignment-reporting'
  | 'assignment-layer-progress';

const ASSIGNMENT_VIEW_TITLES: Record<AssignmentViewId, string> = {
  'assignment-demand': 'Tomorrow Work Demand',
  'assignment-recommended': 'Recommended Assignments',
  'assignment-capacity': 'Painter Capacity',
  'assignment-final': 'Final Assignment',
  'assignment-reporting': 'Reporting',
  'assignment-layer-progress': 'Layer Progress',
};

export const ASSIGNMENT_VIEW_IDS = Object.keys(ASSIGNMENT_VIEW_TITLES) as AssignmentViewId[];

export function getAssignmentViewTitle(view: AssignmentViewId) {
  return ASSIGNMENT_VIEW_TITLES[view];
}

const BILLING_VIEW_TITLES: Record<BillingViewId, string> = {
  'billing-overall': 'Overall Billing',
  'billing-pending': 'Pending Billing',
  'billing-sent': 'Sent For Approval',
  'billing-billed': 'Already Billed',
  'billing-latest': 'Latest Billing',
  'billing-invoice': 'Invoice Details',
  'billing-floor-layer': 'Floor Wise Billing',
  'billing-batch-view': 'Billing Batch View',
};

export const BILLING_VIEW_IDS = Object.keys(BILLING_VIEW_TITLES) as BillingViewId[];

export function getBillingViewTitle(view: BillingViewId) {
  return BILLING_VIEW_TITLES[view];
}
