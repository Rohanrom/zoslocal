import type { ReactNode } from 'react';
import AppShell from '../components/shell/app-shell';

// Draws this hub's pages inside the ZOS app shell (rail, section menu, top bar).
export default function Layout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
