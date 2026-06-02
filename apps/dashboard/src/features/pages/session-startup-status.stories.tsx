import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import { resolveSandboxStatusBadgeUi } from "./sandbox-status-presentation.js";
import { SessionStartupStatus } from "./session-startup-status.js";
import { renderSessionWorkbenchContentStory } from "./session-story-support.js";
import {
  resolveSessionWorkbenchStatus,
  type SandboxStatusReadState,
  type WorkbenchSandboxLifecycleStatus,
} from "./session-workbench-state.js";
import { resolveInitialEntryStartupState } from "./use-session-workbench-lifecycle-state.js";

type LifecycleStateMatrixRow = {
  label: string;
  sandboxLifecycleStatus: WorkbenchSandboxLifecycleStatus;
  sandboxStatusReadState: SandboxStatusReadState;
  sessionSnapshot: "absent" | "present";
};

const LifecycleStateMatrixRows: readonly LifecycleStateMatrixRow[] = [
  {
    label: "Loading status",
    sandboxLifecycleStatus: null,
    sandboxStatusReadState: "loading",
    sessionSnapshot: "absent",
  },
  {
    label: "Pending",
    sandboxLifecycleStatus: "pending",
    sandboxStatusReadState: "ready",
    sessionSnapshot: "absent",
  },
  {
    label: "Starting",
    sandboxLifecycleStatus: "starting",
    sandboxStatusReadState: "ready",
    sessionSnapshot: "absent",
  },
  {
    label: "Started",
    sandboxLifecycleStatus: "started",
    sandboxStatusReadState: "ready",
    sessionSnapshot: "absent",
  },
  {
    label: "Initializing",
    sandboxLifecycleStatus: "initializing",
    sandboxStatusReadState: "ready",
    sessionSnapshot: "absent",
  },
  {
    label: "Resuming",
    sandboxLifecycleStatus: "resuming",
    sandboxStatusReadState: "ready",
    sessionSnapshot: "absent",
  },
  {
    label: "Running before chat",
    sandboxLifecycleStatus: "running",
    sandboxStatusReadState: "ready",
    sessionSnapshot: "absent",
  },
  {
    label: "Running with chat",
    sandboxLifecycleStatus: "running",
    sandboxStatusReadState: "ready",
    sessionSnapshot: "present",
  },
  {
    label: "Degraded before chat",
    sandboxLifecycleStatus: "degraded",
    sandboxStatusReadState: "ready",
    sessionSnapshot: "absent",
  },
  {
    label: "Reconnecting before chat",
    sandboxLifecycleStatus: "reconnecting",
    sandboxStatusReadState: "ready",
    sessionSnapshot: "absent",
  },
  {
    label: "Stopping",
    sandboxLifecycleStatus: "stopping",
    sandboxStatusReadState: "ready",
    sessionSnapshot: "absent",
  },
  {
    label: "Stopped",
    sandboxLifecycleStatus: "stopped",
    sandboxStatusReadState: "ready",
    sessionSnapshot: "absent",
  },
  {
    label: "Failed",
    sandboxLifecycleStatus: "failed",
    sandboxStatusReadState: "ready",
    sessionSnapshot: "absent",
  },
];

function LifecycleStateMatrixStory(): React.JSX.Element {
  return renderSessionWorkbenchContentStory({
    headerStatusUi: resolveSandboxStatusBadgeUi("starting"),
    mainContent: (
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col justify-center gap-4 px-4 py-6">
        <div className="overflow-hidden rounded-md border border-border bg-background">
          <div className="grid grid-cols-[1.2fr_1fr_1fr_1.4fr_1fr] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Lifecycle status</span>
            <span>Header</span>
            <span>Workbench</span>
            <span>Startup placeholder</span>
            <span>Transcript</span>
          </div>
          <div className="divide-y divide-border">
            {LifecycleStateMatrixRows.map((row) => {
              const statusUi = resolveSandboxStatusBadgeUi(row.sandboxLifecycleStatus);
              const startupState = resolveInitialEntryStartupState({
                mainPanelTransitionState: "stable_chat",
                sandboxLifecycleStatus: row.sandboxLifecycleStatus,
                sandboxStatusReadState: row.sandboxStatusReadState,
                sessionSnapshot:
                  row.sessionSnapshot === "present"
                    ? {
                        activeRuntimeConversationCwd: "/root/mistle",
                        activeRuntimeConversationId: "thread_story",
                        connectedAtIso: "2026-04-21T00:00:00.000Z",
                        providerConversationId: null,
                        sandboxInstanceId: "sbi_storybook_bootstrap",
                      }
                    : null,
              });
              const workbenchStatus = resolveSessionWorkbenchStatus({
                sandboxStatusReadState: row.sandboxStatusReadState,
                sandboxLifecycleStatus: row.sandboxLifecycleStatus,
                lifecycleErrorMessage: null,
                reconnectMessage: null,
                sandboxFailureMessage: null,
                stoppedSessionMessage:
                  row.sandboxLifecycleStatus === "stopped"
                    ? "This sandbox is stopped. Chat and terminal are unavailable."
                    : null,
              });
              const transcriptState =
                startupState === null && workbenchStatus.kind === "connected" ? "Shown" : "Hidden";

              return (
                <div
                  className="grid grid-cols-[1.2fr_1fr_1fr_1.4fr_1fr] items-center gap-3 px-3 py-3 text-sm"
                  key={`${row.label}:${row.sessionSnapshot}`}
                >
                  <span className="font-medium text-foreground">{row.label}</span>
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <span
                      aria-hidden
                      className={`size-2.5 rounded-full border ${statusUi.indicatorClassName}`}
                    />
                    {statusUi.label}
                  </span>
                  <span className="capitalize text-muted-foreground">
                    {workbenchStatus.kind.replace("_", " ")}
                  </span>
                  <span>
                    {startupState === null ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <SessionStartupStatus state={startupState} />
                    )}
                  </span>
                  <span className="text-muted-foreground">{transcriptState}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    ),
    mainContentLayout: { scroll: "contained", width: "full" },
    primaryBottomPanel: null,
    sandboxInstanceId: "sbi_storybook_bootstrap",
  });
}

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/StartupStatus",
  component: LifecycleStateMatrixStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardWorkspaceStory],
} satisfies Meta<typeof LifecycleStateMatrixStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const LifecycleStateMatrix: Story = {
  render: () => <LifecycleStateMatrixStory />,
};
