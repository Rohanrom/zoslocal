'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Decorative, non-blocking transition. Never intercepts navigation or data.
 * When used without viewKey it follows route changes; with viewKey it follows
 * the existing dashboard tab. Initial mount deliberately shows no animation.
 */
export default function NightshiftTransition({
  viewKey,
  label,
}: {
  viewKey?: string;
  label?: string;
}) {
  const pathname = usePathname();
  const identity = viewKey === undefined ? pathname : viewKey;
  const previous = useRef<string | undefined>(undefined);
  const [animation, setAnimation] = useState(0);

  useEffect(() => {
    if (previous.current === undefined) {
      previous.current = identity;
      return;
    }
    if (previous.current === identity) return;
    previous.current = identity;
    setAnimation((value) => value + 1);
  }, [identity]);

  // Uses a CSS keyframe rather than a timer or blocking navigation callback.
  // The element is remounted only for a visual animation, never page content.
  if (!animation) return null;

  const caption = label || (pathname.split('/').filter(Boolean).pop() || 'ZOS');
  return (
    <div
      key={animation}
      className="nightshift-brush-transition"
      aria-hidden="true"
    >
      <svg
        className="nightshift-brush-svg"
        viewBox="0 0 1000 600"
        preserveAspectRatio="none"
        focusable="false"
      >
        <path className="nightshift-brush-main" pathLength="100" d="M-160 60 L1160 30 L-160 300 L1160 290 L-160 560 L1160 560" />
        <path className="nightshift-brush-edge" pathLength="100" d="M-160 120 L1160 90 L-160 350 L1160 350 L-160 610 L1160 610" />
        <path className="nightshift-brush-light" pathLength="100" d="M-160 10 L1160 -10 L-160 250 L1160 240 L-160 500 L1160 500" />
      </svg>
      <div className="nightshift-brush-title">{caption}</div>
    </div>
  );
}
