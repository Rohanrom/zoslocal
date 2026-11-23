'use client';

import Link from 'next/link';
import { projectViewHref, type ProjectViewId } from '../../dashboard/view-routes';
import { moduleForView, viewLabel } from './nav-config';

/** Layer 3: the views of the open module, as tabs. Hidden for single-view modules. */
export function ModuleTabs({ projectId, view, role }: { projectId: string; view: ProjectViewId; role: string }) {
  const mod = moduleForView(view, role);
  if (!mod || mod.views.length < 2) return null;

  return (
    <nav aria-label={`${mod.label} views`} className="mb-5 overflow-x-auto border-b border-slate-800">
      <ul className="flex min-w-max gap-6">
        {mod.views.map((item) => {
          const active = item === view;
          return (
            <li key={item}>
              <Link
                href={projectViewHref(projectId, item)}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px inline-flex min-h-11 items-center border-b-2 text-sm ${
                  active ? 'border-[#86AEEA] font-semibold text-white' : 'border-transparent text-slate-400 hover:text-slate-100'
                }`}
              >
                {viewLabel(item)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
