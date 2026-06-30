// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type JSX } from "react";
import { describe, expect, it } from "vitest";

import {
  SandboxProfileSnapshotPanelView,
  SandboxProfileSnapshotRefreshScheduleForm,
  type SnapshotRefreshSchedule,
  type SnapshotRefreshScheduleInput,
} from "./sandbox-profile-snapshot-panel.js";

const ExistingSnapshotRefreshSchedule = {
  scheduleId: "sched_snapshot_refresh",
  name: "Snapshot refresh",
  cronExpression: "0 9 * * 1",
  timezone: "Asia/Singapore",
  enabled: true,
  nextScheduledAt: "2026-04-30T01:00:00.000Z",
} satisfies NonNullable<SnapshotRefreshSchedule>;

describe("SandboxProfileSnapshotPanelView", () => {
  it("shows the persisted publish snapshot failure message when snapshot creation fails", () => {
    render(
      <SandboxProfileSnapshotPanelView
        canRunMaintenanceRefresh={false}
        isActionPending={false}
        onMaintenanceRefreshSnapshot={() => {}}
        onPublishSuccessMessageDismiss={() => {}}
        onRefreshSnapshot={() => {}}
        onRetryPublishSnapshot={() => {}}
        publishSuccessMessage={false}
        publishSuccessMessageKey="idle"
        refreshScheduleSection={null}
        showMaintenanceRefreshAction={false}
        state={{
          kind: "publish-snapshot-error",
          message:
            "Snapshot creation failed because Linear is configured with the wrong type. Update the Linear binding, then retry snapshot creation.\n\nCause: Binding 'ibd_story_linear' has kind 'agent' but definition 'linear::linear-default' has kind 'connector'.",
          operationId: null,
          publishedVersion: 4,
          runnableVersion: 3,
          sandboxInstanceId: null,
        }}
        version={4}
      />,
    );

    expect(
      screen.getByText("Snapshot failed: Linear is configured with the wrong type"),
    ).toBeDefined();
    expect(
      screen.getByText("Update the Linear binding, then retry snapshot creation."),
    ).toBeDefined();
    expect(screen.queryByText("Snapshot creation failed")).toBeNull();
    expect(screen.queryByText(/Binding 'ibd_story_linear' has kind 'agent'/u)).toBeNull();
  });

  it("keeps version-aware recovery guidance for unparsed publish snapshot failure messages", () => {
    render(
      <SandboxProfileSnapshotPanelView
        canRunMaintenanceRefresh={false}
        isActionPending={false}
        onMaintenanceRefreshSnapshot={() => {}}
        onPublishSuccessMessageDismiss={() => {}}
        onRefreshSnapshot={() => {}}
        onRetryPublishSnapshot={() => {}}
        publishSuccessMessage={false}
        publishSuccessMessageKey="idle"
        refreshScheduleSection={null}
        showMaintenanceRefreshAction={false}
        state={{
          kind: "publish-snapshot-error",
          message: "Snapshot materialization failed.",
          operationId: null,
          publishedVersion: 4,
          runnableVersion: 3,
          sandboxInstanceId: null,
        }}
        version={4}
      />,
    );

    expect(screen.getByText("Snapshot creation failed")).toBeDefined();
    expect(
      screen.getByText(
        "Version 4 was published, but its snapshot could not be created. New sessions and triggers will continue using v3 until the snapshot is retried successfully.",
      ),
    ).toBeDefined();
    expect(screen.queryByText("Snapshot materialization failed.")).toBeNull();
  });
});

describe("SandboxProfileSnapshotRefreshScheduleForm", () => {
  it("returns to the automatic snapshot refresh summary after saving maintenance script edits", () => {
    render(<RefreshScheduleSaveHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    updateScriptEditor({
      editor: screen.getByRole("textbox", { name: "Snapshot maintenance script" }),
      value: "echo next",
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByLabelText("Cron expression")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
    expect(screen.getByText("echo next")).toBeDefined();
  });
});

function RefreshScheduleSaveHarness(): JSX.Element {
  const [savedMaintenanceScript, setSavedMaintenanceScript] = useState("echo old");
  const [maintenanceScriptDraft, setMaintenanceScriptDraft] = useState(savedMaintenanceScript);
  const [saveCompletionKey, setSaveCompletionKey] = useState(0);

  function saveSchedule(schedule: SnapshotRefreshScheduleInput): void {
    const nextMaintenanceScript = schedule.maintenanceScript ?? "";
    setSavedMaintenanceScript(nextMaintenanceScript);
    setMaintenanceScriptDraft(nextMaintenanceScript);
    setSaveCompletionKey((currentKey) => currentKey + 1);
  }

  return (
    <SandboxProfileSnapshotRefreshScheduleForm
      disabled={false}
      existingSchedule={ExistingSnapshotRefreshSchedule}
      key={saveCompletionKey}
      maintenanceScriptDraft={maintenanceScriptDraft}
      maintenanceScriptHasChanges={maintenanceScriptDraft !== savedMaintenanceScript}
      mutationError={null}
      onApplyPendingExternalMaintenanceScript={() => {}}
      onChangeMaintenanceScript={setMaintenanceScriptDraft}
      onDeleteSchedule={() => {}}
      onDismissPendingExternalMaintenanceScript={() => {}}
      onSaveSchedule={saveSchedule}
      pendingExternalMaintenanceScript={false}
      previewAfter={new Date("2026-04-29T00:00:00.000Z")}
      savedMaintenanceScript={savedMaintenanceScript}
      setupAssistantControl={{
        disabled: false,
        isStarting: false,
        onToggle: () => {},
        title: "Open the right panel to write this snapshot maintenance script.",
      }}
      testButtonProps={{
        canRun: true,
        status: "idle",
      }}
      testPanel={null}
    />
  );
}

function updateScriptEditor(input: { editor: HTMLElement; value: string }): void {
  const editorView = getScriptEditorView(input.editor);
  act(() => {
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: input.value,
      },
    });
  });
}

function getScriptEditorView(editor: HTMLElement): EditorView {
  const editorElement = editor.closest(".cm-editor");
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("CodeMirror editor element was not found.");
  }

  const editorView = EditorView.findFromDOM(editorElement);
  if (editorView === null) {
    throw new Error("CodeMirror editor view was not found.");
  }

  return editorView;
}
