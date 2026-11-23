import type { ProjectDirectoryProject } from './api';

export type Project = {
  id: string;
  name: string;
  code: string;
  location: string;
  status: string;
  description: string;
  billingEnabled: boolean;
  setupStatus?: string;
  capabilities?: ProjectDirectoryProject['capabilities'];
  counts?: ProjectDirectoryProject['counts'];
};

const LEGACY_PROJECT_METADATA: Record<
  string,
  Pick<Project, 'location' | 'description'>
> = {
  park_heights: {
    location: 'Current active site',
    description:
      'Current working project containing projection layers, layer progress, calculations, tables and forms.',
  },
  indradhanush: {
    location: 'Hoskote',
    description:
      'Indradhanush project dashboard with Billing Engine, invoice summary, billing approval views and batch tracking.',
  },
};

export const analyticsProject: Project = {
  id: 'analytics',
  name: 'Analytics',
  code: 'ANALYTICS',
  location: 'All Projects',
  status: 'Active',
  description:
    'Project-wise executive summary, labour targets, profitability, productivity, cost and operational analytics.',
  billingEnabled: false,
};

// Compatibility fallback for old code paths that still need synchronous
// project lookup (for example the current client panel). The actual projects
// page and dashboard now load operational projects from the database registry.
export const projects: Project[] = [
  {
    id: 'park_heights',
    name: 'APH Project',
    code: 'APH',
    location: LEGACY_PROJECT_METADATA.park_heights.location,
    status: 'Active',
    description: LEGACY_PROJECT_METADATA.park_heights.description,
    billingEnabled: false,
  },
  {
    id: 'indradhanush',
    name: 'Indradhanush',
    code: 'INDR',
    location: LEGACY_PROJECT_METADATA.indradhanush.location,
    status: 'Active',
    description: LEGACY_PROJECT_METADATA.indradhanush.description,
    billingEnabled: true,
  },
  analyticsProject,
];

export function projectFromDirectory(row: ProjectDirectoryProject): Project {
  const legacy = LEGACY_PROJECT_METADATA[row.projectId];

  return {
    id: row.projectId,
    name: row.projectName,
    code: row.projectCode,
    location: legacy?.location || row.setupStatus,
    status: row.status,
    description:
      legacy?.description ||
      `ZOS project workspace. ${row.setupStatus}. Layer, Dimensions and Cost / Work Order setup data drive the common planning and overview modules.`,
    billingEnabled: row.capabilities.billing,
    setupStatus: row.setupStatus,
    capabilities: row.capabilities,
    counts: row.counts,
  };
}

export function getProjectById(projectId: string | null | undefined) {
  if (!projectId) {
    return null;
  }

  // Projects created in Project Setup are not in the fixed list above. Fall
  // back to a basic record so their client users can still log in.
  return (
    projects.find((project) => project.id === projectId) || {
      id: projectId,
      name: projectId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      code: projectId.replace(/_/g, '-').toUpperCase(),
      location: '',
      status: 'Active',
      description: '',
      billingEnabled: false,
    }
  );
}
