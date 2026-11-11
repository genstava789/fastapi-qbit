import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value: number;
  max?: number;
  size?: "sm" | "md" | "lg";
  variant?: "accent" | "success" | "warning" | "danger";
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  size = "md",
  variant = "accent",
  showLabel = false,
  className,
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  const sizes = { sm: "h-1", md: "h-2", lg: "h-3" };
  const variants = {
    accent: "bg-accent",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  };

  const autoVariant =
    variant === "accent"
      ? pct >= 100
        ? "bg-success"
        : pct > 0
        ? "bg-accent"
        : "bg-text-muted"
      : variants[variant];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          "flex-1 rounded-full overflow-hidden bg-surface-elevated",
          sizes[size]
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            autoVariant
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-mono text-text-secondary whitespace-nowrap">
          {pct.toFixed(1)}%
        </span>
      )}
    </div>
  );
}

