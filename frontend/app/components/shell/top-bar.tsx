'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MenuIcon, SearchIcon } from './icons';

export type Crumb = { label: string; href?: string };

/** Top bar: menu button (phones), breadcrumb, search and the user menu. */
export function TopBar({
  crumbs,
  username,
  role,
  onOpenMenu,
  onOpenSearch,
  onLogout,
}: {
  crumbs: Crumb[];
  username: string;
  role: string;
  onOpenMenu: () => void;
  onOpenSearch: () => void;
  onLogout: () => void;
}) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const initials =
    username
      .split(/[.\s_-]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?';

  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-3 md:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-800 text-slate-300 md:hidden"
      >
        <MenuIcon />
      </button>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2 text-sm">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-2">
                {index > 0 && <span aria-hidden="true" className="text-slate-600">/</span>}
                {last || !crumb.href ? (
                  <span aria-current={last ? 'page' : undefined} className={`truncate ${last ? 'font-medium text-white' : 'text-slate-400'}`}>
                    {crumb.label}
                  </span>
                ) : (
                  <Link href={crumb.href} className="truncate text-slate-400 hover:text-white">
                    {crumb.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <button
        type="button"
        onClick={onOpenSearch}
        className="flex h-10 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 text-sm text-slate-400 hover:border-slate-600 hover:text-slate-200"
      >
        <SearchIcon />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-slate-700 px-1.5 font-mono text-[11px] text-slate-500 sm:inline">Ctrl K</kbd>
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setUserMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={userMenuOpen}
          aria-label={`Account: ${username}`}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800 text-sm font-semibold text-white hover:bg-slate-700"
        >
          {initials}
        </button>
        {userMenuOpen && (
          <>
            <button
              type="button"
              aria-label="Close account menu"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setUserMenuOpen(false)}
            />
            <div role="menu" className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-xl">
              <div className="px-3 py-2">
                <div className="truncate text-sm font-semibold text-white">{username}</div>
                <div className="text-xs capitalize text-slate-400">{role || 'viewer'}</div>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={onLogout}
                className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-slate-200 hover:bg-slate-800"
              >
                Log out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
