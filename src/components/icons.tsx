/**
 * Small drawn marks for the interface.
 *
 * Everything here replaced a character that was standing in for an icon —
 * 🎟️, 🖼️, ✨, ✦, 🎬. A character is not a shape we control: the platform
 * picks the font, so the same mark arrives flat on one phone and as a colour
 * emoji on the next, sits on a baseline instead of centred, and in one case
 * (a note plus a combining slash) rendered as two glyphs side by side.
 *
 * All of these share the dock's 24-unit grid and 1.5 stroke, so a mark dropped
 * into a new surface already matches the rest.
 */

import type { ReactNode } from 'react';

interface MarkProps {
  /** Rendered size in px. Defaults to the inline text size. */
  size?: number;
  children: ReactNode;
}

function Mark({ size = 16, children }: MarkProps) {
  return (
    <svg
      aria-hidden="true"
      className="icon-mark"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

/** A torn-edge admission ticket, for the gacha ticket tally. */
export function TicketIcon({ size }: { size?: number }) {
  return (
    <Mark size={size}>
      <path d="M3.5 8.5 A2 2 0 0 0 3.5 15.5 V18 a1 1 0 0 0 1 1 h15 a1 1 0 0 0 1-1 v-2.5 a2 2 0 0 1 0-7 V6 a1 1 0 0 0-1-1 h-15 a1 1 0 0 0-1 1 Z" />
      <path d="M14 7.5 V9 M14 11.2 V12.8 M14 15 V16.5" />
    </Mark>
  );
}

/** A framed picture, for the sky-image export. */
export function ImageIcon({ size }: { size?: number }) {
  return (
    <Mark size={size}>
      <rect height="15" rx="2.2" width="18" x="3" y="4.5" />
      <circle cx="8.6" cy="10" r="1.6" />
      <path d="M3.4 16.2 L8.8 11.6 L13.2 15.4 L16.4 12.8 L20.6 16.4" />
    </Mark>
  );
}

/** A four-point sparkle with a small companion, for a repeat viewing. */
export function SparkleIcon({ size }: { size?: number }) {
  return (
    <Mark size={size}>
      <path d="M10 3.5 L11.6 8.4 L16.5 10 L11.6 11.6 L10 16.5 L8.4 11.6 L3.5 10 L8.4 8.4 Z" />
      <path d="M17.5 14.5 L18.3 16.7 L20.5 17.5 L18.3 18.3 L17.5 20.5 L16.7 18.3 L14.5 17.5 L16.7 16.7 Z" />
    </Mark>
  );
}

/** A filled four-point star, the badge on an unlock announcement. */
export function UnlockBadgeIcon({ size }: { size?: number }) {
  return (
    <Mark size={size}>
      <path
        d="M12 2.6 L14.1 9.9 L21.4 12 L14.1 14.1 L12 21.4 L9.9 14.1 L2.6 12 L9.9 9.9 Z"
        fill="currentColor"
        stroke="none"
      />
    </Mark>
  );
}

/** A film frame, standing in for a poster that TMDB does not have. */
export function FilmFrameIcon({ size }: { size?: number }) {
  return (
    <Mark size={size}>
      <rect height="15" rx="2.2" width="18" x="3" y="4.5" />
      <path d="M7.6 4.5 V19.5 M16.4 4.5 V19.5 M3 12 H21" />
    </Mark>
  );
}
