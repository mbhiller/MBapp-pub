import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "destructive";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-slate-900 text-white",
  secondary: "bg-slate-100 text-slate-900",
  outline: "border border-slate-300 text-slate-800",
  success: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  destructive: "bg-red-100 text-red-800 border border-red-200",
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
);

Badge.displayName = "Badge";
