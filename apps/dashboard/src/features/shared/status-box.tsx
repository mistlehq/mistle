import { cn } from "@mistle/ui";
import type { ReactNode } from "react";

export type StatusBoxProps = {
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "destructive";
  variant?: "boxed" | "subtle";
};

export function StatusBox(input: StatusBoxProps): React.JSX.Element {
  const tone = input.tone ?? "neutral";
  const variant = input.variant ?? "boxed";

  return (
    <div
      className={cn(
        variant === "boxed" ? "rounded-lg px-3.5 py-3" : "rounded-md px-3 py-2",
        variant === "boxed" ? "border" : "border-transparent",
        tone === "destructive"
          ? variant === "boxed"
            ? "bg-destructive/5 border-destructive/40 text-destructive"
            : "bg-destructive/5 text-destructive"
          : variant === "boxed"
            ? "bg-muted/20 text-muted-foreground"
            : "bg-muted/20 text-muted-foreground",
        input.className,
      )}
    >
      <div className="text-sm">{input.children}</div>
    </div>
  );
}
