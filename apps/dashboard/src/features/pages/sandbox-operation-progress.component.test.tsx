// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { SandboxOperationEvent } from "../sessions/sessions-types.js";
import { SandboxOperationProgressView } from "./sandbox-operation-progress.js";

const AnsiEscapeCharacter = String.fromCharCode(27);

afterEach(() => {
  cleanup();
});

describe("SandboxOperationProgressView", () => {
  it("renders lifecycle events and transcript records returned by the operation events API", async () => {
    render(
      <SandboxOperationProgressView
        events={[
          createLifecycleEvent({
            id: "soe_provider_started",
            message: "Starting provider sandbox.",
            phase: "provider",
            sequence: 1,
            status: "started",
          }),
          createLifecycleEvent({
            id: "soe_runtime_plan_completed",
            message: "Runtime plan applied.",
            phase: "runtime_plan",
            sequence: 2,
            status: "completed",
          }),
          createTranscriptEvent({
            id: "soe_transcript_stdout",
            payload: "Installing dependencies",
            phase: "runtime_plan",
            sequence: 3,
            stream: "stdout",
          }),
          createTranscriptEvent({
            id: "soe_transcript_stderr",
            payload: "\u001b[31mRetrying failed download\u001b[0m",
            phase: "runtime_plan",
            sequence: 4,
            stream: "stderr",
          }),
          createTranscriptEvent({
            id: "soe_transcript_system",
            payload: "apply_runtime_plan completed",
            phase: "runtime_plan",
            sequence: 5,
            stream: "system",
          }),
        ]}
        title="Snapshot creation progress"
      />,
    );

    expect(screen.getByRole("heading", { name: "Snapshot creation progress" })).toBeDefined();
    expect(screen.getByText("Sandbox")).toBeDefined();
    expect(screen.getByText("Runtime plan")).toBeDefined();
    expect(screen.queryByText("Starting provider sandbox.")).toBeNull();
    expect(screen.queryByText("Runtime plan applied.")).toBeNull();
    await waitFor(() => {
      expect(screen.getByText(/Installing dependencies/u)).toBeDefined();
      expect(screen.getByText(/Retrying failed download/u)).toBeDefined();
    });
    expect(screen.getByText("Terminal output")).toBeDefined();
    expect(screen.queryByText(/apply_runtime_plan completed/u)).toBeNull();
    expect(document.body.textContent?.includes(AnsiEscapeCharacter)).toBe(false);
  });

  it("collapses lifecycle start and completion records for the same phase", () => {
    render(
      <SandboxOperationProgressView
        events={[
          createLifecycleEvent({
            id: "soe_provider_started",
            message: "Snapshot sandbox provider start started.",
            phase: "provider",
            sequence: 1,
            status: "started",
          }),
          createLifecycleEvent({
            id: "soe_provider_completed",
            message: "Snapshot sandbox provider start completed.",
            observedAt: "2026-05-13T10:00:03.000Z",
            phase: "provider",
            sequence: 2,
            status: "completed",
          }),
        ]}
        title="Snapshot creation progress"
      />,
    );

    const timeline = screen.getByText("Sandbox").closest("ol");
    if (timeline === null) {
      throw new Error("Expected sandbox operation timeline to render.");
    }

    expect(within(timeline).queryByText("Snapshot sandbox provider start started.")).toBeNull();
    expect(within(timeline).queryByText("Snapshot sandbox provider start completed.")).toBeNull();
    expect(within(timeline).getAllByText("Sandbox")).toHaveLength(1);
    expect(within(timeline).getByText("3s")).toBeDefined();
    expectScreenReaderOnlyText(timeline, "Status: completed");
  });

  it("uses explicit timeline keys and labels when lifecycle events split one backend phase", () => {
    render(
      <SandboxOperationProgressView
        events={[
          createLifecycleEvent({
            attributes: {
              timelineKey: "runtime-artifacts",
              timelineLabel: "Installing runtime artifacts",
            },
            id: "soe_runtime_artifacts_completed",
            message: "runtime artifacts installed",
            phase: "runtime_plan",
            sequence: 1,
            status: "started",
          }),
          createLifecycleEvent({
            attributes: {
              timelineKey: "runtime-artifacts",
              timelineLabel: "Installing runtime artifacts",
            },
            id: "soe_runtime_artifacts_completed",
            message: "runtime artifacts installed",
            observedAt: "2026-05-13T10:01:12.000Z",
            phase: "runtime_plan",
            sequence: 2,
            status: "completed",
          }),
          createLifecycleEvent({
            attributes: {
              timelineKey: "workspace",
              timelineLabel: "Preparing workspace",
            },
            id: "soe_workspace_started",
            message: "workspace sources started",
            phase: "runtime_plan",
            sequence: 3,
            status: "started",
          }),
        ]}
        title="Sandbox startup timeline"
      />,
    );

    const timeline = screen.getByText("Installing runtime artifacts").closest("ol");
    if (timeline === null) {
      throw new Error("Expected sandbox operation timeline to render.");
    }

    expect(within(timeline).getByText("Installing runtime artifacts")).toBeDefined();
    expect(within(timeline).getByText("Preparing workspace")).toBeDefined();
    expect(within(timeline).getByText("1m 12s")).toBeDefined();
    expect(within(timeline).queryByText("Runtime plan")).toBeNull();
  });

  it("does not render lifecycle events marked as hidden from the timeline", () => {
    render(
      <SandboxOperationProgressView
        events={[
          createLifecycleEvent({
            attributes: {
              timelineHidden: true,
            },
            id: "soe_running_started",
            message: "Sandbox instance running status transition started.",
            phase: "running",
            sequence: 1,
            status: "started",
          }),
          createLifecycleEvent({
            id: "soe_ready_started",
            message: "Sandbox runtime ready.",
            phase: "ready",
            sequence: 2,
            status: "started",
          }),
        ]}
        title="Sandbox startup timeline"
      />,
    );

    const timeline = screen.getByText("Ready").closest("ol");
    if (timeline === null) {
      throw new Error("Expected sandbox operation timeline to render.");
    }

    expect(within(timeline).queryByText("Running")).toBeNull();
    expect(within(timeline).getByText("Ready")).toBeDefined();
  });

  it("shows elapsed duration for an active lifecycle row", () => {
    render(
      <SandboxOperationProgressView
        events={[
          createLifecycleEvent({
            id: "soe_provider_started",
            message: "Sandbox provider start started.",
            observedAt: "2026-05-13T10:00:00.000Z",
            phase: "provider",
            sequence: 1,
            status: "started",
          }),
        ]}
        nowMs={Date.parse("2026-05-13T10:00:15.000Z")}
        title="Snapshot creation progress"
      />,
    );

    const timeline = screen.getByText("Sandbox").closest("ol");
    if (timeline === null) {
      throw new Error("Expected sandbox operation timeline to render.");
    }

    expect(within(timeline).getByText("15s")).toBeDefined();
    expectScreenReaderOnlyText(timeline, "Status: started");
  });

  it("resets active elapsed duration when a lifecycle row retries after failure", () => {
    render(
      <SandboxOperationProgressView
        events={[
          createLifecycleEvent({
            id: "soe_provider_started",
            message: "Sandbox provider start started.",
            observedAt: "2026-05-13T10:00:00.000Z",
            phase: "provider",
            sequence: 1,
            status: "started",
          }),
          createLifecycleEvent({
            id: "soe_provider_failed",
            message: "Sandbox provider start failed.",
            observedAt: "2026-05-13T10:02:00.000Z",
            phase: "provider",
            sequence: 2,
            status: "failed",
          }),
          createLifecycleEvent({
            id: "soe_provider_restarted",
            message: "Sandbox provider start started.",
            observedAt: "2026-05-13T10:03:00.000Z",
            phase: "provider",
            sequence: 3,
            status: "started",
          }),
        ]}
        nowMs={Date.parse("2026-05-13T10:03:05.000Z")}
        title="Snapshot creation progress"
      />,
    );

    const timeline = screen.getByText("Sandbox").closest("ol");
    if (timeline === null) {
      throw new Error("Expected sandbox operation timeline to render.");
    }

    expect(within(timeline).getByText("5s")).toBeDefined();
    expect(within(timeline).queryByText("3m 5s")).toBeNull();
    expectScreenReaderOnlyText(timeline, "Status: started");
  });

  it("keeps one lifecycle row when worker and sandboxd report the same phase", () => {
    render(
      <SandboxOperationProgressView
        events={[
          createLifecycleEvent({
            id: "soe_worker_sandboxd_started",
            message: "Snapshot sandboxd initialization started.",
            phase: "sandboxd",
            sequence: 1,
            source: "worker",
            status: "started",
          }),
          createLifecycleEvent({
            id: "soe_sandboxd_started",
            message: "sandboxd started",
            phase: "sandboxd",
            sequence: 2,
            source: "sandboxd",
            status: "started",
          }),
        ]}
        title="Snapshot creation progress"
      />,
    );

    const timeline = screen.getByText("Sandbox daemon").closest("ol");
    if (timeline === null) {
      throw new Error("Expected sandbox operation timeline to render.");
    }

    expect(within(timeline).queryByText("Snapshot sandboxd initialization started.")).toBeNull();
    expect(within(timeline).queryByText("sandboxd started")).toBeNull();
    expect(within(timeline).getAllByText("Sandbox daemon")).toHaveLength(1);
    expectScreenReaderOnlyText(timeline, "Status: started");
  });

  it("keeps collapsed lifecycle rows in first-seen phase order", () => {
    render(
      <SandboxOperationProgressView
        events={[
          createLifecycleEvent({
            id: "soe_sandboxd_worker_started",
            message: "Snapshot sandboxd initialization started.",
            phase: "sandboxd",
            sequence: 1,
            status: "started",
          }),
          createLifecycleEvent({
            id: "soe_operation_stream_completed",
            message: "operation_stream completed",
            phase: "operation_stream",
            sequence: 2,
            status: "completed",
          }),
          createLifecycleEvent({
            id: "soe_sandboxd_completed",
            message: "Snapshot sandboxd initialization completed.",
            phase: "sandboxd",
            sequence: 3,
            status: "completed",
          }),
        ]}
        title="Snapshot creation progress"
      />,
    );

    const timeline = screen.getByText("Tunnel").closest("ol");
    if (timeline === null) {
      throw new Error("Expected sandbox operation timeline to render.");
    }

    const timelineText = timeline.textContent ?? "";
    expect(timelineText.indexOf("Sandbox daemon")).toBeLessThan(timelineText.indexOf("Tunnel"));
    expect(within(timeline).queryByText("Snapshot sandboxd initialization started.")).toBeNull();
    expect(within(timeline).queryByText("Snapshot sandboxd initialization completed.")).toBeNull();
    expectScreenReaderOnlyText(timeline, "Status: completed");
  });

  it("does not regress a completed phase when a late started event arrives", () => {
    render(
      <SandboxOperationProgressView
        events={[
          createLifecycleEvent({
            id: "soe_runtime_adapters_started",
            message: "runtime_adapters started",
            phase: "runtime_adapters",
            sequence: 1,
            source: "sandboxd",
            status: "started",
          }),
          createLifecycleEvent({
            id: "soe_runtime_adapters_completed",
            message: "Setup-check sandbox runtime adapters initialized.",
            phase: "runtime_adapters",
            sequence: 2,
            source: "worker",
            status: "completed",
          }),
          createLifecycleEvent({
            id: "soe_runtime_adapters_late_started",
            message: "runtime_adapters started",
            phase: "runtime_adapters",
            sequence: 3,
            source: "sandboxd",
            status: "started",
          }),
        ]}
        title="Maintenance script test progress"
      />,
    );

    const timeline = screen.getByText("Runtime adapters").closest("ol");
    if (timeline === null) {
      throw new Error("Expected sandbox operation timeline to render.");
    }

    expect(within(timeline).getAllByText("Runtime adapters")).toHaveLength(1);
    expectScreenReaderOnlyText(timeline, "Status: completed");
  });

  it("shows retry progress when a failed phase starts again", () => {
    render(
      <SandboxOperationProgressView
        events={[
          createLifecycleEvent({
            id: "soe_runtime_adapters_started",
            message: "runtime_adapters started",
            phase: "runtime_adapters",
            sequence: 1,
            source: "sandboxd",
            status: "started",
          }),
          createLifecycleEvent({
            id: "soe_runtime_adapters_failed",
            message: "runtime_adapters failed",
            phase: "runtime_adapters",
            sequence: 2,
            source: "sandboxd",
            status: "failed",
          }),
          createLifecycleEvent({
            id: "soe_runtime_adapters_retry_started",
            message: "runtime_adapters retry started",
            phase: "runtime_adapters",
            sequence: 3,
            source: "sandboxd",
            status: "started",
          }),
        ]}
        title="Maintenance script test progress"
      />,
    );

    const timeline = screen.getByText("Runtime adapters").closest("ol");
    if (timeline === null) {
      throw new Error("Expected sandbox operation timeline to render.");
    }

    expect(within(timeline).getAllByText("Runtime adapters")).toHaveLength(1);
    expectScreenReaderOnlyText(timeline, "Status: started");
  });

  it("keeps warning and failed status text screen-reader-only", () => {
    render(
      <SandboxOperationProgressView
        displayMode="timeline"
        events={[
          createLifecycleEvent({
            id: "soe_runtime_plan_warning",
            message: "Runtime plan warning.",
            phase: "runtime_plan",
            sequence: 1,
            status: "warning",
          }),
          createLifecycleEvent({
            id: "soe_snapshot_failed",
            message: "Snapshot capture failed.",
            phase: "snapshot",
            sequence: 2,
            status: "failed",
          }),
        ]}
        title="Snapshot creation progress"
      />,
    );

    const timeline = screen.getByText("Runtime plan").closest("ol");
    if (timeline === null) {
      throw new Error("Expected sandbox operation timeline to render.");
    }

    expectScreenReaderOnlyText(timeline, "Status: warning");
    expectScreenReaderOnlyText(timeline, "Status: failed");
  });

  it("expands warning and failure details from lifecycle messages", () => {
    render(
      <SandboxOperationProgressView
        displayMode="timeline"
        events={[
          createLifecycleEvent({
            id: "soe_setup_script_warning",
            message: "Setup script emitted a warning.",
            phase: "setup_script",
            sequence: 1,
            status: "warning",
          }),
          createLifecycleEvent({
            attributes: {
              error: "runtime plan artifacts[0] lifecycle.install[0] failed.",
            },
            id: "soe_runtime_plan_failed",
            message: "Runtime plan failed.",
            phase: "runtime_plan",
            sequence: 2,
            status: "failed",
          }),
        ]}
        title="Snapshot creation progress"
      />,
    );

    expect(screen.queryByText("Setup script emitted a warning.")).toBeNull();
    expect(screen.queryByText(/Runtime plan failed/u)).toBeNull();

    fireEvent.click(screen.getByLabelText("Show Setup script details"));
    expect(screen.getByText("Setup script emitted a warning.")).toBeDefined();

    fireEvent.click(screen.getByLabelText("Show Runtime plan details"));
    expect(screen.getByText(/Runtime plan failed/u)).toBeDefined();
    expect(screen.getByText(/runtime plan artifacts\[0\]/u)).toBeDefined();

    fireEvent.click(screen.getByLabelText("Hide Runtime plan details"));
    expect(screen.queryByText(/Runtime plan failed/u)).toBeNull();
  });

  it("keeps phase details expanded when a newer lifecycle event replaces the row", () => {
    const { rerender } = render(
      <SandboxOperationProgressView
        displayMode="timeline"
        events={[
          createLifecycleEvent({
            id: "soe_sandboxd_failed_initial",
            message: "Sandbox daemon initialization failed.",
            phase: "sandboxd",
            sequence: 1,
            status: "failed",
          }),
        ]}
        title="Snapshot creation progress"
      />,
    );

    fireEvent.click(screen.getByLabelText("Show Sandbox daemon details"));
    expect(screen.getByText("Sandbox daemon initialization failed.")).toBeDefined();

    rerender(
      <SandboxOperationProgressView
        displayMode="timeline"
        events={[
          createLifecycleEvent({
            id: "soe_sandboxd_failed_initial",
            message: "Sandbox daemon initialization failed.",
            phase: "sandboxd",
            sequence: 1,
            status: "failed",
          }),
          createLifecycleEvent({
            id: "soe_sandboxd_failed_updated",
            message: "Sandbox daemon reported a newer failure.",
            phase: "sandboxd",
            sequence: 2,
            status: "failed",
          }),
        ]}
        title="Snapshot creation progress"
      />,
    );

    expect(screen.getByLabelText("Hide Sandbox daemon details")).toBeDefined();
    expect(screen.getByText("Sandbox daemon reported a newer failure.")).toBeDefined();
    expect(screen.queryByText("Sandbox daemon initialization failed.")).toBeNull();
  });

  it("resets expanded phase details after operation events are cleared", () => {
    const { rerender } = render(
      <SandboxOperationProgressView
        displayMode="timeline"
        events={[
          createLifecycleEvent({
            id: "soe_sandboxd_failed_first_run",
            message: "First run failed.",
            phase: "sandboxd",
            sequence: 1,
            status: "failed",
          }),
        ]}
        title="Snapshot creation progress"
      />,
    );

    fireEvent.click(screen.getByLabelText("Show Sandbox daemon details"));
    expect(screen.getByText("First run failed.")).toBeDefined();

    rerender(
      <SandboxOperationProgressView
        displayMode="timeline"
        events={[]}
        title="Snapshot creation progress"
      />,
    );

    rerender(
      <SandboxOperationProgressView
        displayMode="timeline"
        events={[
          createLifecycleEvent({
            id: "soe_sandboxd_failed_second_run",
            message: "Second run failed.",
            operationId: "owfr_operation_progress_second_run",
            phase: "sandboxd",
            sequence: 1,
            status: "failed",
          }),
        ]}
        title="Snapshot creation progress"
      />,
    );

    expect(screen.getByLabelText("Show Sandbox daemon details")).toBeDefined();
    expect(screen.queryByText("Second run failed.")).toBeNull();
  });

  it("does not infer lifecycle phases when no events have been returned", () => {
    render(
      <SandboxOperationProgressView
        emptyMessage="Waiting for snapshot materialization events."
        events={[]}
        title="Snapshot creation progress"
      />,
    );

    expect(screen.getByText("Waiting for snapshot materialization events.")).toBeDefined();
    expect(screen.getByText("No lifecycle events yet.")).toBeDefined();
    expect(screen.getByText("No output yet.")).toBeDefined();
    expect(screen.queryByText("Sandbox")).toBeNull();
  });

  it("can render only the lifecycle timeline", () => {
    render(
      <SandboxOperationProgressView
        displayMode="timeline"
        events={[
          createLifecycleEvent({
            id: "soe_provider_completed",
            message: "Provider sandbox started.",
            phase: "provider",
            sequence: 1,
            status: "completed",
          }),
          createTranscriptEvent({
            id: "soe_transcript_stdout",
            payload: "Installing dependencies",
            phase: "runtime_plan",
            sequence: 2,
            stream: "stdout",
          }),
        ]}
        title="Snapshot creation progress"
      />,
    );

    expect(screen.getByText("Sandbox")).toBeDefined();
    expect(screen.queryByText("Provider sandbox started.")).toBeNull();
    expect(screen.queryByText("Terminal output")).toBeNull();
    expect(screen.queryByText(/Installing dependencies/u)).toBeNull();
  });

  it("can render only stdout and stderr transcript output", async () => {
    render(
      <SandboxOperationProgressView
        displayMode="stdio"
        events={[
          createLifecycleEvent({
            id: "soe_provider_completed",
            message: "Provider sandbox started.",
            phase: "provider",
            sequence: 1,
            status: "completed",
          }),
          createTranscriptEvent({
            id: "soe_transcript_stdout",
            payload: "Installing dependencies",
            phase: "runtime_plan",
            sequence: 2,
            stream: "stdout",
          }),
          createTranscriptEvent({
            id: "soe_transcript_system",
            payload: "runtime_plan completed",
            phase: "runtime_plan",
            sequence: 3,
            stream: "system",
          }),
        ]}
        title="Snapshot creation progress"
      />,
    );

    expect(screen.getByText("Terminal output")).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText(/Installing dependencies/u)).toBeDefined();
    });
    expect(screen.queryByText("Provider sandbox started.")).toBeNull();
    expect(screen.queryByText(/runtime_plan completed/u)).toBeNull();
  });

  it("omits the progress header when no title is provided", () => {
    render(
      <SandboxOperationProgressView
        emptyMessage="Waiting for setup-check sandbox startup events."
        events={[
          createLifecycleEvent({
            id: "soe_sandboxd_completed",
            message: "Sandbox daemon connected.",
            phase: "sandboxd",
            sequence: 1,
            status: "completed",
          }),
        ]}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Sandbox startup" })).toBeNull();
    expect(screen.queryByText("1 events received")).toBeNull();
    expect(screen.getByText("Sandbox daemon")).toBeDefined();
    expect(screen.queryByText("Sandbox daemon connected.")).toBeNull();
  });

  it("surfaces a non-blocking progress load error without hiding existing events", () => {
    render(
      <SandboxOperationProgressView
        errorMessage="Could not load sandbox operation progress."
        events={[
          createLifecycleEvent({
            id: "soe_sandboxd_completed",
            message: "Sandbox daemon connected.",
            phase: "sandboxd",
            sequence: 1,
            status: "completed",
          }),
        ]}
        title="Sandbox startup"
      />,
    );

    expect(screen.getByText("Progress unavailable")).toBeDefined();
    expect(screen.getByText("Could not load sandbox operation progress.")).toBeDefined();
    const timeline = screen.getByText("Sandbox daemon").closest("ol");
    if (timeline === null) {
      throw new Error("Expected sandbox operation timeline to render.");
    }
    expect(within(timeline).getByText("Sandbox daemon")).toBeDefined();
    expect(within(timeline).queryByText("Sandbox daemon connected.")).toBeNull();
  });

  it("can suppress non-blocking progress load errors", () => {
    render(
      <SandboxOperationProgressView
        errorMessage="Could not load sandbox operation progress."
        events={[
          createLifecycleEvent({
            id: "soe_sandboxd_completed",
            message: "Sandbox daemon connected.",
            phase: "sandboxd",
            sequence: 1,
            status: "completed",
          }),
        ]}
        showLoadError={false}
        title="Snapshot creation progress"
      />,
    );

    expect(screen.queryByText("Progress unavailable")).toBeNull();
    expect(screen.queryByText("Could not load sandbox operation progress.")).toBeNull();
    expect(screen.getByText("Sandbox daemon")).toBeDefined();
  });
});

function createLifecycleEvent(input: {
  attributes?: Record<string, unknown>;
  id: string;
  message: string;
  observedAt?: string;
  operationId?: string;
  phase: NonNullable<SandboxOperationEvent["phase"]>;
  sequence: number;
  source?: SandboxOperationEvent["source"];
  status: NonNullable<SandboxOperationEvent["status"]>;
}): SandboxOperationEvent {
  return {
    attributes: input.attributes ?? {},
    createdAt: "2026-05-13T10:00:00.000Z",
    id: input.id,
    message: input.message,
    observedAt: input.observedAt ?? "2026-05-13T10:00:00.000Z",
    operationId: input.operationId ?? "owfr_operation_progress_test",
    operationKind: "snapshot",
    payloadBase64: null,
    phase: input.phase,
    recordKind: "lifecycle",
    sandboxInstanceId: "sbi_operation_progress_test",
    sequence: input.sequence,
    source: input.source ?? "worker",
    status: input.status,
    stream: null,
  };
}

function expectScreenReaderOnlyText(container: HTMLElement, text: string): void {
  const elements = within(container).getAllByText(text);
  for (const element of elements) {
    expect(element.classList.contains("sr-only")).toBe(true);
  }
}

function createTranscriptEvent(input: {
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
    operationId: "owfr_operation_progress_test",
    operationKind: "snapshot",
    payloadBase64: window.btoa(input.payload),
    phase: input.phase,
    recordKind: "transcript",
    sandboxInstanceId: "sbi_operation_progress_test",
    sequence: input.sequence,
    source: "sandboxd",
    status: null,
    stream: input.stream,
  };
}
