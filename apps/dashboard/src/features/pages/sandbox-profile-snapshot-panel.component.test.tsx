// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type JSX } from "react";
import { describe, expect, it } from "vitest";

import {
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
