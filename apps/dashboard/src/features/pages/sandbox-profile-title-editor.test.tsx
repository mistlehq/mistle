// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SandboxProfileTitleEditor } from "./sandbox-profile-title-editor.js";

describe("SandboxProfileTitleEditor", () => {
  afterEach(() => {
    cleanup();
  });

  function TitleEditorHarness(): React.JSX.Element {
    const [isEditing, setIsEditing] = useState(false);
    const [draftValue, setDraftValue] = useState("My Profile");
    const [commitCount, setCommitCount] = useState(0);
    const [cancelCount, setCancelCount] = useState(0);

    return (
      <div>
        <SandboxProfileTitleEditor
          draftValue={draftValue}
          isEditing={isEditing}
          onCancel={() => {
            setCancelCount((current) => current + 1);
            setIsEditing(false);
          }}
          onCommit={() => {
            setCommitCount((current) => current + 1);
            setIsEditing(false);
          }}
          onDraftValueChange={setDraftValue}
          onEditStart={() => {
            setIsEditing(true);
          }}
          saveDisabled={false}
          title="My Profile"
        />
        <p>Commit count: {commitCount}</p>
        <p>Cancel count: {cancelCount}</p>
      </div>
    );
  }

  it("switches into edit mode when edit icon is clicked", () => {
    render(<TitleEditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Edit profile name" }));
    expect(screen.getByRole("textbox", { name: "Profile name" })).toBeDefined();
  });

  it("commits on blur while editing", () => {
    render(<TitleEditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Edit profile name" }));
    fireEvent.blur(screen.getByRole("textbox", { name: "Profile name" }));

    expect(screen.getByText("Commit count: 1")).toBeDefined();
  });

  it("cancels on Escape while editing", () => {
    render(<TitleEditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Edit profile name" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Profile name" }), {
      key: "Escape",
    });

    expect(screen.getByText("Cancel count: 1")).toBeDefined();
  });
});
