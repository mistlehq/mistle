import { cn } from "@mistle/ui";
import type { ReactNode } from "react";

export type SectionHeaderProps = {
  className?: string;
  description?: ReactNode;
  size?: "base" | "large";
  title: ReactNode;
};

export function SectionHeader(input: SectionHeaderProps): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-1", input.className)}>
      <h2 className={cn(input.size === "large" ? "text-lg" : "text-base", "font-medium")}>
        {input.title}
      </h2>
      {input.description === undefined ? null : (
        <p className="text-muted-foreground text-sm">{input.description}</p>
      )}
    </div>
  );
}
