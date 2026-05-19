import { OverflowTooltipText } from "@mistle/ui";

import type { CodexThreadNavigatorRow } from "./codex-thread-navigator-model.js";

export function CodexThreadHeaderScope(input: {
  row: CodexThreadNavigatorRow | null;
}): React.JSX.Element | null {
  if (input.row === null) {
    return null;
  }

  return (
    <div
      aria-label="Active Codex thread"
      className="hidden min-w-0 max-w-64 items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-muted-foreground text-xs md:flex"
      title={input.row.cwd}
    >
      <span className="shrink-0 font-medium text-foreground">Thread</span>
      <OverflowTooltipText
        className="min-w-0"
        text={input.row.title}
        tooltipSide="bottom"
        tooltipSideOffset={8}
      />
    </div>
  );
}
