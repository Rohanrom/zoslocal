'use client';

import Link from 'next/link';
import type { Hub } from './nav-config';
import { HUB_ICONS } from './icons';

/** Layer 1: the hubs. Always visible on desktop; inside the menu on phones. */
export function GlobalRail({
  hubs,
  activeHubId,
  homeHref,
  layout = 'rail',
  onNavigate,
}: {
  hubs: Hub[];
  activeHubId: string | null;
  homeHref: string;
  layout?: 'rail' | 'list';
  onNavigate?: () => void;
}) {
  if (layout === 'list') {
    return (
      <nav aria-label="Hubs" className="flex flex-col gap-1">
        {hubs.map((hub) => {
          const active = hub.id === activeHubId;
          return (
            <Link
              key={hub.id}
              href={hub.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                active ? 'bg-[#F7A05A]/10 text-[#F7A05A]' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {HUB_ICONS[hub.id]}
              {hub.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Hubs"
      className="hidden w-[76px] shrink-0 flex-col items-center gap-1 border-r border-slate-800 bg-[#0D1426] py-3 md:flex"
    >
      <Link
        href={homeHref}
        className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[#F7A05A] font-display text-base font-bold text-[#1A1206]"
        aria-label="ZOS home"
      >
        Z
      </Link>
      {hubs.map((hub) => {
        const active = hub.id === activeHubId;
        return (
          <Link
            key={hub.id}
            href={hub.href}
            aria-current={active ? 'page' : undefined}
            className={`flex w-16 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium transition ${
              active ? 'bg-[#F7A05A]/10 text-[#F7A05A]' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
            }`}
          >
            {HUB_ICONS[hub.id]}
            <span>{hub.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
