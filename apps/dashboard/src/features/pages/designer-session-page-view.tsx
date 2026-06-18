import "dockview/dist/styles/dockview.css";
import "./session-terminal-workspace.css";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewWillDropEvent,
  type DockviewWillShowOverlayLocationEvent,
  type IDockviewPanelProps,
} from "dockview";
import type { FunctionComponent } from "react";

import type { DesignerSession } from "../designer/designer-service.js";

type DesignerCanvasTab = DesignerSession["canvasTabs"][number];

type DesignerCanvasDockviewParams = {
  href: string;
};

type DesignerCanvasDockviewPanelProps = IDockviewPanelProps<DesignerCanvasDockviewParams>;

function readRequiredDesignerCanvasHref(parameters: unknown): string {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    throw new Error("Designer canvas panel parameters must include href.");
  }

  const href = Reflect.get(parameters, "href");
  if (typeof href !== "string" || href.length === 0) {
    throw new Error("Designer canvas panel href must be a non-empty string.");
  }

  return href;
}

function DesignerCanvasDockviewPanel(input: DesignerCanvasDockviewPanelProps): React.JSX.Element {
  const href = readRequiredDesignerCanvasHref(input.params);

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background p-4 text-sm text-muted-foreground">
      <span className="max-w-full truncate font-mono">{href}</span>
    </div>
  );
}

const DesignerCanvasDockviewComponents = {
  canvas: DesignerCanvasDockviewPanel,
} satisfies Record<string, FunctionComponent<DesignerCanvasDockviewPanelProps>>;

function preventDesignerCanvasLayoutDrop(event: DockviewWillDropEvent): void {
  if (event.kind === "tab" || event.kind === "header_space") {
    return;
  }

  event.preventDefault();
}

function preventDesignerCanvasLayoutOverlay(event: DockviewWillShowOverlayLocationEvent): void {
  if (event.kind === "tab" || event.kind === "header_space") {
    return;
  }

  event.preventDefault();
}

function buildDesignerCanvasWorkspaceKey(tabs: readonly DesignerCanvasTab[]): string {
  if (tabs.length === 0) {
    return "empty";
  }

  return tabs.map((tab) => tab.id).join(":");
}

export function DesignerCanvasWorkspace(input: {
  tabs: readonly DesignerCanvasTab[];
}): React.JSX.Element {
  if (input.tabs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-4 text-sm text-muted-foreground">
        Canvas
      </div>
    );
  }

  return (
    <div
      className="session-terminal-dockview dockview-theme-light min-h-0 min-w-0 flex-1 overflow-hidden"
      key={buildDesignerCanvasWorkspaceKey(input.tabs)}
    >
      <DockviewReact
        className="h-full"
        components={DesignerCanvasDockviewComponents}
        disableTabsOverflowList
        disableFloatingGroups
        dndEdges={false}
        onReady={(event: { api: DockviewApi }) => {
          event.api.onWillShowOverlay(preventDesignerCanvasLayoutOverlay);

          for (const tab of input.tabs) {
            event.api.addPanel({
              id: tab.id,
              title: tab.title,
              component: "canvas",
              params: {
                href: tab.href,
              },
              renderer: "always",
            });
          }
        }}
        onWillDrop={preventDesignerCanvasLayoutDrop}
      />
    </div>
  );
}
