'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '../../lib/session';
import AppShell from '../components/shell/app-shell';

const OEM_ROLES = ['admin', 'viewer'];

export default function OemLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, role } = useSession();
  const allowed = status === 'signed-in' && OEM_ROLES.includes(role);
  useEffect(() => {
    // Signed-out users are sent to login by the app shell.
    if (status === 'signed-in' && !OEM_ROLES.includes(role)) router.replace('/projects');
  }, [status, role, router]);
  if (!allowed) return <AppShell><main className="min-h-screen bg-slate-950 p-8 text-slate-300">Opening OEM workspace...</main></AppShell>;
  const nav = (href: string, label: string) => (
    <Link href={href} className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${pathname === href ? 'border-cyan-500 bg-cyan-500 text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-100 hover:border-cyan-500'}`}>{label}</Link>
  );
  return (
    <AppShell>
    <main className="min-h-screen bg-slate-950 px-4 pb-14 text-slate-100 sm:px-7">
      <div className="mx-auto max-w-[1500px]">
        <div className="sticky top-0 z-30 -mx-4 border-b border-slate-800 bg-slate-950/95 px-4 pb-4 pt-4 backdrop-blur sm:-mx-7 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link href="/projects" className="text-sm text-cyan-300 hover:underline">← All ZOS tiles</Link>
              <h1 className="mt-1 text-2xl font-bold">OEM · Materials & Quotations</h1>
              <p className="text-xs text-slate-400">Independent material catalogue and site quotation history</p>
            </div>
            <div className="flex flex-wrap gap-2">{nav('/oem', '1 · Material / OEM')}{nav('/oem/quotations', '2 · Site Quotations')}</div>
          </div>
        </div>
        <div className="pt-6">{children}</div>
      </div>
    </main>
    </AppShell>
  );
}