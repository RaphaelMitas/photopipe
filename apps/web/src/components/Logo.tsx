export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="Photopipe"
    >
      <path
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M28 13H20a13 13 0 0 0-13 13v12a13 13 0 0 0 13 13h8"
      />
      <rect
        fill="var(--pp-accent)"
        x="16"
        y="24"
        width="12"
        height="16"
        rx="6"
      />
      <path
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        d="M38 16v32"
      />
      <path
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        opacity=".6"
        d="M48 22v20"
      />
      <path
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        opacity=".3"
        d="M57 27v10"
      />
    </svg>
  );
}
