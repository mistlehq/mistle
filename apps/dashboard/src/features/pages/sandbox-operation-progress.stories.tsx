import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import type { SandboxOperationEvent } from "../sessions/sessions-types.js";
import { SandboxOperationProgressView } from "./sandbox-operation-progress.js";

const meta = {
  args: {
    nowMs: Date.parse("2026-05-13T10:02:58.000Z"),
  },
  component: SandboxOperationProgressView,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
  title: "Dashboard/SandboxOperations/Progress",
} satisfies Meta<typeof SandboxOperationProgressView>;

export default meta;

type Story = StoryObj<typeof meta>;

const LifecycleStatusStateEvents = [
  lifecycleEvent({
    id: "soe_story_status_completed",
    message: "Sandbox finished.",
    phase: "provider",
    sequence: 1,
    source: "worker",
    status: "completed",
  }),
  lifecycleEvent({
    id: "soe_story_status_started",
    message: "Snapshot capture started.",
    phase: "snapshot",
    sequence: 2,
    source: "worker",
    status: "started",
  }),
  lifecycleEvent({
    id: "soe_story_status_warning",
    message: "Setup script completed with warnings.",
    phase: "setup_script",
    sequence: 3,
    source: "sandboxd",
    status: "warning",
  }),
  lifecycleEvent({
    attributes: {
      error:
        "runtime plan artifacts[0] lifecycle.install[0] failed: GitHub release lookup returned 403.",
    },
    id: "soe_story_status_failed",
    message: "Runtime plan failed.",
    phase: "runtime_plan",
    sequence: 4,
    source: "sandboxd",
    status: "failed",
  }),
] satisfies readonly SandboxOperationEvent[];

const DetailedStartupTimelineEvents = [
  lifecycleEvent({
    attributes: {
      timelineKey: "image",
      timelineLabel: "Preparing image",
    },
    id: "soe_story_startup_image_started",
    message: "Sandbox provider image preparation started.",
    observedAt: "2026-05-13T10:00:00.000Z",
    phase: "provider",
    sequence: 1,
    source: "worker",
    status: "started",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "image",
      timelineLabel: "Preparing image",
    },
    id: "soe_story_startup_image_completed",
    message: "Sandbox provider image preparation completed.",
    observedAt: "2026-05-13T10:00:07.000Z",
    phase: "provider",
    sequence: 2,
    source: "worker",
    status: "completed",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "sandbox",
      timelineLabel: "Creating sandbox",
    },
    id: "soe_story_startup_sandbox_started",
    message: "Sandbox provider start started.",
    observedAt: "2026-05-13T10:00:07.000Z",
    phase: "provider",
    sequence: 3,
    source: "worker",
    status: "started",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "sandbox",
      timelineLabel: "Creating sandbox",
    },
    id: "soe_story_startup_sandbox_completed",
    message: "Sandbox provider start completed.",
    observedAt: "2026-05-13T10:00:31.000Z",
    phase: "provider",
    sequence: 4,
    source: "worker",
    status: "completed",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "tunnel",
      timelineLabel: "Connecting tunnel",
    },
    id: "soe_story_startup_tunnel_started",
    message: "start_tunnel_session started",
    observedAt: "2026-05-13T10:00:34.000Z",
    phase: "operation_stream",
    sequence: 5,
    source: "sandboxd",
    status: "started",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "tunnel",
      timelineLabel: "Connecting tunnel",
    },
    id: "soe_story_startup_tunnel_completed",
    message: "start_tunnel_session completed",
    observedAt: "2026-05-13T10:00:35.000Z",
    phase: "operation_stream",
    sequence: 6,
    source: "sandboxd",
    status: "completed",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "git-identity",
      timelineLabel: "Configuring Git",
    },
    id: "soe_story_startup_git_started",
    message: "apply_git_identity started",
    observedAt: "2026-05-13T10:00:35.000Z",
    phase: "git_identity",
    sequence: 7,
    source: "sandboxd",
    status: "started",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "git-identity",
      timelineLabel: "Configuring Git",
    },
    id: "soe_story_startup_git_completed",
    message: "apply_git_identity completed",
    observedAt: "2026-05-13T10:00:36.000Z",
    phase: "git_identity",
    sequence: 8,
    source: "sandboxd",
    status: "completed",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "egress-proxy",
      timelineLabel: "Starting egress proxy",
    },
    id: "soe_story_startup_egress_started",
    message: "start_egress_proxy started",
    observedAt: "2026-05-13T10:00:36.000Z",
    phase: "egress",
    sequence: 9,
    source: "sandboxd",
    status: "started",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "egress-proxy",
      timelineLabel: "Starting egress proxy",
    },
    id: "soe_story_startup_egress_completed",
    message: "start_egress_proxy completed",
    observedAt: "2026-05-13T10:00:38.000Z",
    phase: "egress",
    sequence: 10,
    source: "sandboxd",
    status: "completed",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "runtime-artifacts",
      timelineLabel: "Installing runtime artifacts",
    },
    id: "soe_story_startup_runtime_artifacts_started",
    message: "runtime artifacts installation started",
    observedAt: "2026-05-13T10:00:38.000Z",
    phase: "runtime_plan",
    sequence: 11,
    source: "sandboxd",
    status: "started",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "runtime-artifacts",
      timelineLabel: "Installing runtime artifacts",
    },
    id: "soe_story_startup_runtime_artifacts_completed",
    message: "runtime artifacts installed",
    observedAt: "2026-05-13T10:01:47.000Z",
    phase: "runtime_plan",
    sequence: 12,
    source: "sandboxd",
    status: "completed",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "workspace",
      timelineLabel: "Preparing workspace",
    },
    id: "soe_story_startup_workspace_started",
    message: "workspace sources started",
    observedAt: "2026-05-13T10:01:47.000Z",
    phase: "runtime_plan",
    sequence: 13,
    source: "sandboxd",
    status: "started",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "workspace",
      timelineLabel: "Preparing workspace",
    },
    id: "soe_story_startup_workspace_completed",
    message: "workspace sources applied",
    observedAt: "2026-05-13T10:01:52.000Z",
    phase: "runtime_plan",
    sequence: 14,
    source: "sandboxd",
    status: "completed",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "runtime-files",
      timelineLabel: "Writing runtime files",
    },
    id: "soe_story_startup_runtime_files_started",
    message: "runtime files started",
    observedAt: "2026-05-13T10:01:52.000Z",
    phase: "runtime_plan",
    sequence: 15,
    source: "sandboxd",
    status: "started",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "runtime-files",
      timelineLabel: "Writing runtime files",
    },
    id: "soe_story_startup_runtime_files_completed",
    message: "runtime files written",
    observedAt: "2026-05-13T10:01:53.000Z",
    phase: "runtime_plan",
    sequence: 16,
    source: "sandboxd",
    status: "completed",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "setup-script",
      timelineLabel: "Running setup script",
    },
    id: "soe_story_startup_setup_script_started",
    message: "run_setup_script started",
    observedAt: "2026-05-13T10:01:53.000Z",
    phase: "setup_script",
    sequence: 17,
    source: "sandboxd",
    status: "started",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "setup-script",
      timelineLabel: "Running setup script",
    },
    id: "soe_story_startup_setup_script_completed",
    message: "run_setup_script completed",
    observedAt: "2026-05-13T10:02:27.000Z",
    phase: "setup_script",
    sequence: 18,
    source: "sandboxd",
    status: "completed",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "runtime-process:codex-app-server",
      timelineLabel: "Starting Codex app server",
    },
    id: "soe_story_startup_codex_app_server_started",
    message: "Codex app server start started.",
    observedAt: "2026-05-13T10:02:27.000Z",
    phase: "runtime_processes",
    sequence: 19,
    source: "sandboxd",
    status: "started",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "runtime-process:codex-app-server",
      timelineLabel: "Starting Codex app server",
    },
    id: "soe_story_startup_codex_app_server_completed",
    message: "Codex app server readiness completed.",
    observedAt: "2026-05-13T10:02:39.000Z",
    phase: "runtime_processes",
    sequence: 20,
    source: "sandboxd",
    status: "completed",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "runtime-adapter:codex",
      timelineLabel: "Starting Codex adapter",
    },
    id: "soe_story_startup_codex_adapter_started",
    message: "Codex runtime adapter start started.",
    observedAt: "2026-05-13T10:02:39.000Z",
    phase: "runtime_adapters",
    sequence: 21,
    source: "sandboxd",
    status: "started",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "runtime-adapter:codex",
      timelineLabel: "Starting Codex adapter",
    },
    id: "soe_story_startup_codex_adapter_completed",
    message: "Codex runtime adapter started.",
    observedAt: "2026-05-13T10:02:42.000Z",
    phase: "runtime_adapters",
    sequence: 22,
    source: "sandboxd",
    status: "completed",
  }),
  lifecycleEvent({
    attributes: {
      timelineKey: "ready",
      timelineLabel: "Ready",
    },
    id: "soe_story_startup_ready_started",
    message: "Sandbox runtime readiness wait started.",
    observedAt: "2026-05-13T10:02:42.000Z",
    phase: "ready",
    sequence: 23,
    source: "worker",
    status: "started",
  }),
] satisfies readonly SandboxOperationEvent[];

export const SnapshotCreating: Story = {
  args: {
    events: [
      lifecycleEvent({
        id: "soe_story_provider_started",
        message: "Starting provider sandbox.",
        phase: "provider",
        sequence: 1,
        source: "worker",
        status: "started",
      }),
      lifecycleEvent({
        id: "soe_story_provider_completed",
        message: "Provider sandbox started.",
        phase: "provider",
        sequence: 2,
        source: "worker",
        status: "completed",
      }),
      lifecycleEvent({
        id: "soe_story_sandboxd_completed",
        message: "Sandboxd bootstrap tunnel connected.",
        phase: "sandboxd",
        sequence: 3,
        source: "gateway",
        status: "completed",
      }),
      transcriptEvent({
        id: "soe_story_runtime_plan_stdout",
        payload: "\u001b[32mInstalling package graph\u001b[0m",
        phase: "runtime_plan",
        sequence: 4,
        stream: "stdout",
      }),
      transcriptEvent({
        id: "soe_story_runtime_plan_stderr",
        payload: "\u001b[33mwarning: cache miss for pnpm store\u001b[0m",
        phase: "runtime_plan",
        sequence: 5,
        stream: "stderr",
      }),
      lifecycleEvent({
        id: "soe_story_snapshot_started",
        message: "Capturing snapshot image.",
        phase: "snapshot",
        sequence: 6,
        source: "worker",
        status: "started",
      }),
    ],
    title: "Snapshot creation progress",
  },
};

export const DetailedStartupTimeline: Story = {
  args: {
    displayMode: "timeline",
    events: DetailedStartupTimelineEvents,
    isLoading: true,
    title: "Sandbox startup timeline",
  },
};

export const TimelineStatusStates: Story = {
  args: {
    displayMode: "timeline",
    events: LifecycleStatusStateEvents,
    title: "Sandbox operation status states",
  },
};

export const WaitingForEvents: Story = {
  args: {
    emptyMessage: "Waiting for setup-check sandbox startup events.",
    events: [],
    isLoading: true,
    title: "Sandbox startup",
  },
};

export const TimelineOnly: Story = {
  args: {
    displayMode: "timeline",
    events: SnapshotCreating.args.events,
    title: "Sandbox startup timeline",
  },
};

export const StdioOnly: Story = {
  args: {
    displayMode: "stdio",
    events: SnapshotCreating.args.events,
    title: "Setup script output",
  },
};

export const ProgressUnavailable: Story = {
  args: {
    errorMessage: "Could not load sandbox operation progress.",
    events: [
      lifecycleEvent({
        id: "soe_story_existing_sandboxd",
        message: "Sandboxd bootstrap tunnel connected.",
        phase: "sandboxd",
        sequence: 1,
        source: "gateway",
        status: "completed",
      }),
    ],
    title: "Sandbox startup",
  },
};

function lifecycleEvent(input: {
  attributes?: Record<string, unknown>;
  id: string;
  message: string;
  observedAt?: string;
  phase: NonNullable<SandboxOperationEvent["phase"]>;
  sequence: number;
  source: SandboxOperationEvent["source"];
  status: NonNullable<SandboxOperationEvent["status"]>;
}): SandboxOperationEvent {
  return {
    attributes: input.attributes ?? {},
    createdAt: "2026-05-13T10:00:00.000Z",
    id: input.id,
    message: input.message,
    observedAt: input.observedAt ?? "2026-05-13T10:00:00.000Z",
    operationId: "ssj_story_snapshot",
    operationKind: "snapshot",
    payloadBase64: null,
    phase: input.phase,
    recordKind: "lifecycle",
    sandboxInstanceId: "sbi_story_snapshot",
    sequence: input.sequence,
    source: input.source,
    status: input.status,
    stream: null,
  };
}

function transcriptEvent(input: {
  id: string;
  payload: string;
  phase: NonNullable<SandboxOperationEvent["phase"]>;
  sequence: number;
  stream: NonNullable<SandboxOperationEvent["stream"]>;
}): SandboxOperationEvent {
  return {
    attributes: {},
    createdAt: "2026-05-13T10:00:00.000Z",
    id: input.id,
    message: "",
    observedAt: "2026-05-13T10:00:01.000Z",
    operationId: "ssj_story_snapshot",
    operationKind: "snapshot",
    payloadBase64: btoa(input.payload),
    phase: input.phase,
    recordKind: "transcript",
    sandboxInstanceId: "sbi_story_snapshot",
    sequence: input.sequence,
    source: "sandboxd",
    status: null,
    stream: input.stream,
  };
}
