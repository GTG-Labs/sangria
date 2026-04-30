import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "blue";
type Size = "sm" | "md";

const slotStyles: Record<Variant, string> = {
  primary: "btn-raised",
  secondary: "btn-raised-secondary",
  blue: "btn-raised-blue",
};

const sizeStyles: Record<Size, string> = {
  sm: "px-7 py-2.5 text-xs leading-none",
  md: "px-10 py-3 text-sm leading-none",
};

type BaseProps = {
  variant?: Variant;
  size?: Size;
  glow?: boolean;
  className?: string;
  children: ReactNode;
};

type AsLink = BaseProps & {
  href: string;
} & Omit<ComponentProps<typeof Link>, "className" | "children">;

type AsButton = BaseProps & {
  href?: never;
} & Omit<ComponentProps<"button">, "className" | "children">;

type ArcadeButtonProps = AsLink | AsButton;

export default function ArcadeButton({
  variant = "primary",
  size = "md",
  glow = false,
  className = "",
  children,
  ...rest
}: ArcadeButtonProps) {
  const slotClass = [
    slotStyles[variant],
    glow && "glow",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const hasFullWidth = className?.split(/\s+/).includes("w-full");
  const faceClass = [sizeStyles[size], hasFullWidth && "w-full"].filter(Boolean).join(" ");
  const face = <span className={faceClass}>{children}</span>;

  if ("href" in rest && rest.href != null) {
    return (
      <Link className={slotClass} {...(rest as Omit<AsLink, keyof BaseProps>)}>
        {face}
      </Link>
    );
  }

  const { type = "button", ...buttonProps } = rest as Omit<AsButton, keyof BaseProps>;
  return (
    <button type={type} className={slotClass} {...buttonProps}>
      {face}
    </button>
  );
}
