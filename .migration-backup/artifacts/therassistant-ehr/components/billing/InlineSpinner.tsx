import type { CSSProperties } from "react";

export interface InlineSpinnerProps {
  size?: number;
  color?: string;
  thickness?: number;
  ariaLabel?: string;
  style?: CSSProperties;
}

export function InlineSpinner({
  size = 12,
  color = "currentColor",
  thickness = 2,
  ariaLabel = "Loading",
  style,
}: InlineSpinnerProps) {
  return (
    <span
      role="status"
      aria-label={ariaLabel}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        border: `${thickness}px solid currentColor`,
        borderTopColor: "transparent",
        opacity: 0.7,
        color,
        animation: "ta-spin 0.7s linear infinite",
        verticalAlign: "-2px",
        ...style,
      }}
    />
  );
}
