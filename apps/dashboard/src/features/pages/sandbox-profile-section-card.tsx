import { cn } from "@mistle/ui";
import type { ReactNode } from "react";

export function SandboxProfileSectionCard(input: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn("rounded-md border bg-card p-4", input.className)}
      data-slot="sandbox-profile-section-card"
    >
      {input.children}
    </div>
  );
}
