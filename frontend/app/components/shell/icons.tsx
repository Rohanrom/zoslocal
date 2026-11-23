// Outline icons for the shell (24 x 24, stroke = currentColor).
// Decorative: every use sits next to a visible label, so they are aria-hidden.

import type { ReactNode } from 'react';
import type { HubId } from './nav-config';

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const HUB_ICONS: Record<HubId, ReactNode> = {
  home: (
    <Svg>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </Svg>
  ),
  projects: (
    <Svg>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Svg>
  ),
  estimation: (
    <Svg>
      <rect x="5" y="2.5" width="14" height="19" rx="2" />
      <path d="M8 7h8" />
      <path d="M8 12h1M12 12h1M8 16h1M12 16h1M16 12v5" />
    </Svg>
  ),
  analytics: (
    <Svg>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Svg>
  ),
  masters: (
    <Svg>
      <path d="M3 12V4h8l10 10-8 8z" />
      <circle cx="7.5" cy="8.5" r="1.3" />
    </Svg>
  ),
  admin: (
    <Svg>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </Svg>
  ),
};

export const SearchIcon = () => (
  <Svg size={16}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </Svg>
);

export const MenuIcon = () => (
  <Svg size={20}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg size={18}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const ChevronIcon = () => (
  <Svg size={14}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
