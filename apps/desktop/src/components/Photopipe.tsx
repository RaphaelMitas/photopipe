import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { title?: string };

/**
 * Photopipe mark (from brand/). Ink follows `currentColor`; the accent reads
 * the `--pp-accent` custom property and falls back to brand orange.
 *
 *   <Photopipe className="h-8 w-8" />
 */
export function Photopipe({ title = "Photopipe", ...props }: Props) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={title}
      {...props}
    >
      <path
        d="M28 13H20a13 13 0 0 0-13 13v12a13 13 0 0 0 13 13h8"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="16"
        y="24"
        width="12"
        height="16"
        rx="6"
        fill="var(--pp-accent, #FF7A2F)"
      />
      <path
        d="M38 16v32"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M48 22v20"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        opacity={0.6}
      />
      <path
        d="M57 27v10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        opacity={0.3}
      />
    </svg>
  );
}
