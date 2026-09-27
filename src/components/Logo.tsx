/**
 * The mark: an eye caught mid-blink — a lens, the lid halfway down. Drawn
 * inline so it takes the current text colour; the lower half is the accent.
 */
export function Mark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={className}
    >
      <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeWidth="2.5" />
      <path d="M5.2 18.5 A 11.5 11.5 0 0 0 26.8 18.5 Z" fill="#1f5c56" />
      <path d="M4 16 H 28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Mark plus wordmark, for the navigation bar and the landing page. */
export default function Logo({ size = 24 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-stone-900">
      <Mark size={size} />
      <span className="font-display text-xl font-medium tracking-tight">Blinked</span>
    </span>
  );
}
