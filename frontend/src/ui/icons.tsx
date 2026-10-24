import type { LucideProps } from 'lucide-react';

/**
 * Math glyphs Lucide does not have, drawn on its 24px grid with its stroke conventions so
 * they sit alongside Lucide icons and take the same props.
 */
export function IntegralIcon({ size = 24, strokeWidth = 2, className, ...rest }: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      <path d="M17 4.5C16.4 3.5 15.5 3 14.5 3c-2 0-2.7 1.6-3 3.5l-2 11c-.3 1.9-1 3.5-3 3.5-1 0-1.9-.5-2.5-1.5" />
    </svg>
  );
}
