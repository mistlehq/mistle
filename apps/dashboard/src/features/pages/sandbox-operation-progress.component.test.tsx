// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(within(timeline).getByText("completed")).toBeDefined();
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
    expect(within(timeline).getByText("started")).toBeDefined();
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
    expect(within(timeline).getAllByText("completed")).toHaveLength(2);
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
  id: string;
  message: string;
  phase: NonNullable<SandboxOperationEvent["phase"]>;
  sequence: number;
  source?: SandboxOperationEvent["source"];
  status: NonNullable<SandboxOperationEvent["status"]>;
}): SandboxOperationEvent {
  return {
    attributes: {},
    createdAt: "2026-05-13T10:00:00.000Z",
    id: input.id,
    message: input.message,
    observedAt: "2026-05-13T10:00:00.000Z",
    operationId: "owfr_operation_progress_test",
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
