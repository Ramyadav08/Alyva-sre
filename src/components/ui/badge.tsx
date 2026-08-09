import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Variants map directly onto this app's existing status vocabulary
// (pending/edited/approved/rejected/applied/apply_failed, reported/resolved,
// business-impact, AI-reasoning) rather than shadcn's generic default/secondary/
// destructive set — every place in the dashboard that shows a status pill uses
// one of these, so the color meaning stays consistent app-wide.
const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "bg-muted text-muted-foreground",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        error: "bg-error/10 text-error",
        info: "bg-info/10 text-info",
        primary: "bg-primary/10 text-primary",
        ai: "bg-ai/10 text-ai",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
