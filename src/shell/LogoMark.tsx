/**
 * The product mark: a page with a filled-in line and a check. Replace this
 * component (and src-tauri/icons) to rebrand.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="3.5" y="2" width="17" height="20" rx="4" fill="var(--ff-accent)" />
      <path d="M7.5 8.25h9" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.5 12h5.5" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
      <path d="m8 16.1 2 1.9 4.9-4.6" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
