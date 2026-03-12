// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { EditablePageTitle } from "./editable-page-title.js";

describe("EditablePageTitle", () => {
  afterEach(() => {
    cleanup();
  });

  function TitleEditorHarness(): React.JSX.Element {
    const [isEditing, setIsEditing] = useState(false);
    const [draftValue, setDraftValue] = useState("My Title");
    const [commitCount, setCommitCount] = useState(0);
    const [cancelCount, setCancelCount] = useState(0);

    return (
      <div>
        <EditablePageTitle
          ariaLabel="Page title"
          cancelOnEscape={true}
          draftValue={draftValue}
          editButtonLabel="Edit page title"
          errorMessage={undefined}
          isEditing={isEditing}
          maxWidthClassName={undefined}
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
          placeholder={undefined}
          saveDisabled={false}
          title="My Title"
        />
        <p>Commit count: {commitCount}</p>
        <p>Cancel count: {cancelCount}</p>
      </div>
    );
  }

  it("switches into edit mode when edit icon is clicked", () => {
    render(<TitleEditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Edit page title" }));
    expect(screen.getByRole("textbox", { name: "Page title" })).toBeDefined();
  });

  it("commits on blur while editing", () => {
    render(<TitleEditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Edit page title" }));
    fireEvent.blur(screen.getByRole("textbox", { name: "Page title" }));

    expect(screen.getByText("Commit count: 1")).toBeDefined();
  });

  it("cancels on Escape while editing", () => {
    render(<TitleEditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Edit page title" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Page title" }), {
      key: "Escape",
    });

    expect(screen.getByText("Cancel count: 1")).toBeDefined();
  });
});
