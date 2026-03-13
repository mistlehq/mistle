// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { EditableHeading } from "./editable-heading.js";

describe("EditableHeading", () => {
  afterEach(() => {
    cleanup();
  });

  function HeadingEditorHarness(): React.JSX.Element {
    const [isEditing, setIsEditing] = useState(false);
    const [draftValue, setDraftValue] = useState("My Title");
    const [commitCount, setCommitCount] = useState(0);
    const [cancelCount, setCancelCount] = useState(0);

    return (
      <div>
        <EditableHeading
          ariaLabel="Heading"
          cancelOnEscape={true}
          draftValue={draftValue}
          editButtonLabel="Edit heading"
          errorMessage={undefined}
          headingTag="h2"
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
          value="My Title"
        />
        <p>Commit count: {commitCount}</p>
        <p>Cancel count: {cancelCount}</p>
      </div>
    );
  }

  it("switches into edit mode when edit icon is clicked", () => {
    render(<HeadingEditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Edit heading" }));
    expect(screen.getByRole("textbox", { name: "Heading" })).toBeDefined();
  });

  it("commits on blur while editing", () => {
    render(<HeadingEditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Edit heading" }));
    fireEvent.blur(screen.getByRole("textbox", { name: "Heading" }));

    expect(screen.getByText("Commit count: 1")).toBeDefined();
  });

  it("cancels on Escape while editing", () => {
    render(<HeadingEditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Edit heading" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Heading" }), {
      key: "Escape",
    });

    expect(screen.getByText("Cancel count: 1")).toBeDefined();
  });
});
