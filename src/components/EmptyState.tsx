import type { ReactNode } from 'react';

export type EmptyStateVariant = 'archive' | 'watchlist' | 'constellation' | 'blackhole';

interface EmptyStateProps {
  variant: EmptyStateVariant;
  /** Primary line; kept as its own text node so existing queries still match. */
  title: string;
  hint?: string;
  role?: 'status';
  action?: { label: string; onClick: () => void };
}

/**
 * A hand-drawn stroke illustration turns an empty region from a dead end into
 * an invitation. Line art only (no assets, no external hosts): a dashed
 * constellation for an empty archive, a nebula ring for the watchlist, a
 * linked path for constellations, an accretion ring for the blackhole.
 */
function Illustration({ variant }: { variant: EmptyStateVariant }): ReactNode {
  const common = {
    'aria-hidden': true,
    className: 'empty-state-art',
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    viewBox: '0 0 96 64',
  };
  if (variant === 'watchlist') {
    return (
      <svg {...common}>
        <ellipse cx="48" cy="32" rx="30" ry="18" strokeDasharray="3 4" strokeWidth="1.4" />
        <circle cx="48" cy="32" r="3.2" fill="currentColor" stroke="none" opacity="0.7" />
        <circle cx="30" cy="24" r="1.1" fill="currentColor" stroke="none" opacity="0.6" />
        <circle cx="66" cy="40" r="1.1" fill="currentColor" stroke="none" opacity="0.6" />
      </svg>
    );
  }
  if (variant === 'constellation') {
    return (
      <svg {...common}>
        <path d="M18 44 L36 30 L52 38 L74 18" strokeDasharray="3 4" strokeWidth="1.4" opacity="0.8" />
        {[[18, 44], [36, 30], [52, 38], [74, 18]].map(([x, y]) => (
          <circle cx={x} cy={y} fill="currentColor" key={`${x}-${y}`} r="1.8" stroke="none" />
        ))}
      </svg>
    );
  }
  if (variant === 'blackhole') {
    return (
      <svg {...common}>
        <ellipse cx="48" cy="32" rx="28" ry="10" strokeDasharray="2 5" strokeWidth="1.4" />
        <circle cx="48" cy="32" r="8" strokeWidth="1.4" />
        <circle cx="48" cy="32" r="3.4" fill="currentColor" stroke="none" opacity="0.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M22 42 L38 26 L50 34 L70 20" strokeDasharray="3 5" strokeWidth="1.3" opacity="0.7" />
      {[[22, 42], [38, 26], [50, 34], [70, 20]].map(([x, y], index) => (
        <circle
          cx={x}
          cy={y}
          fill="currentColor"
          key={`${x}-${y}`}
          opacity={index === 3 ? 1 : 0.55}
          r={index === 3 ? 2.2 : 1.4}
          stroke="none"
        />
      ))}
    </svg>
  );
}

export function EmptyState({ variant, title, hint, role, action }: EmptyStateProps) {
  return (
    <div className="empty-state empty-state-rich" role={role}>
      <Illustration variant={variant} />
      <p className="empty-state-title">{title}</p>
      {hint !== undefined && <p className="empty-state-hint">{hint}</p>}
      {action !== undefined && (
        <button className="secondary-action empty-state-action" onClick={action.onClick} type="button">
          {action.label}
        </button>
      )}
    </div>
  );
}
