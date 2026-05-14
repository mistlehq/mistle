import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import type { SandboxOperationEvent } from "../sessions/sessions-types.js";
import { SandboxOperationProgressView } from "./sandbox-operation-progress.js";

const meta = {
  component: SandboxOperationProgressView,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
  title: "Pages/Sandbox Operation Progress",
} satisfies Meta<typeof SandboxOperationProgressView>;

export default meta;

type Story = StoryObj<typeof meta>;

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
  id: string;
  message: string;
  phase: NonNullable<SandboxOperationEvent["phase"]>;
  sequence: number;
  source: SandboxOperationEvent["source"];
  status: NonNullable<SandboxOperationEvent["status"]>;
}): SandboxOperationEvent {
  return {
    attributes: {},
    createdAt: "2026-05-13T10:00:00.000Z",
    id: input.id,
    message: input.message,
    observedAt: "2026-05-13T10:00:00.000Z",
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
