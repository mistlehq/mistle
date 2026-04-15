// @vitest-environment jsdom

import { createManualScheduler, createMutableClock } from "@mistle/time/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { AutoSaveInlineHeading, AutoSaveTitleHeading } from "./auto-save-inline-heading.js";

describe("AutoSaveInlineHeading", () => {
  afterEach(() => {
    cleanup();
  });

  function getSaveState(input: { label: string }): string | null {
    return (
      screen
        .getByRole("textbox", { name: input.label })
        .closest("[data-save-state]")
        ?.getAttribute("data-save-state") ?? null
    );
  }

  it("shows a validation error and keeps the inline field visible when the value is invalid", async () => {
    render(
      <AutoSaveInlineHeading
        ariaLabel="Heading"
        value="Repo Maintainer"
        onSave={async () => {}}
        successFadeDurationMs={20}
        successVisibleDurationMs={40}
        validate={(nextValue) => {
          return nextValue.trim().length === 0 ? "Heading is required." : null;
        }}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Heading" });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(await screen.findByText("Heading is required.")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Heading" })).toBeDefined();
  });

  it("keeps the inline field visible after a successful save", async () => {
    function ControlledHarness(): React.JSX.Element {
      const [value, setValue] = useState("Repo Maintainer");

      return (
        <AutoSaveInlineHeading
          ariaLabel="Heading"
          onSave={async (nextValue) => {
            setValue(nextValue);
          }}
          successFadeDurationMs={20}
          successVisibleDurationMs={40}
          validate={() => null}
          value={value}
        />
      );
    }

    render(<ControlledHarness />);

    const input = screen.getByRole("textbox", { name: "Heading" });
    fireEvent.change(input, { target: { value: "New Title" } });
    fireEvent.blur(input);

    expect(getSaveState({ label: "Heading" })).toBe("saving");

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Heading" })).toHaveProperty("value", "New Title");
    });
  });

  it("keeps the inline field disabled when saves are disabled", () => {
    render(
      <AutoSaveInlineHeading
        ariaLabel="Heading"
        disabled={true}
        value="Repo Maintainer"
        onSave={async () => {}}
        validate={() => null}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Heading" })).toHaveProperty("disabled", true);
  });

  it("uses the display fallback as placeholder text without seeding the input value", () => {
    render(
      <AutoSaveInlineHeading
        ariaLabel="Heading"
        displayText="profile_123"
        value=""
        onSave={async () => {}}
        validate={() => null}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Heading" });
    expect(input).toHaveProperty("value", "");
    expect(input.getAttribute("placeholder")).toBe("profile_123");
  });

  it("disables the input while saving", async () => {
    let resolveSave: (() => void) | undefined;
    render(
      <AutoSaveInlineHeading
        ariaLabel="Heading"
        value="Repo Maintainer"
        onSave={() =>
          new Promise<void>((resolve) => {
            resolveSave = resolve;
          })
        }
        successFadeDurationMs={20}
        successVisibleDurationMs={40}
        validate={() => null}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Heading" });
    fireEvent.change(input, { target: { value: "New Title" } });
    fireEvent.blur(input);

    expect(screen.getByRole("textbox", { name: "Heading" })).toHaveProperty("disabled", true);

    const finishSave = resolveSave;
    if (finishSave === undefined) {
      throw new Error("Expected save resolver to be captured.");
    }
    finishSave();

    return waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Heading" })).toHaveProperty("value", "New Title");
    });
  });

  it("keeps retry text across rerenders with the same error message", () => {
    function ErrorHarness(): React.JSX.Element {
      const [revision, setRevision] = useState(0);
      const [errorMessage, setErrorMessage] = useState("Could not update heading.");

      return (
        <div>
          <button
            onClick={() => {
              setRevision((current) => current + 1);
              setErrorMessage("Could not update heading.");
            }}
            type="button"
          >
            Rerender
          </button>
          <AutoSaveInlineHeading
            ariaLabel="Heading"
            errorMessage={errorMessage}
            value="Repo Maintainer"
            onSave={async () => {}}
            validate={() => null}
          />
          <span>{revision}</span>
        </div>
      );
    }

    render(<ErrorHarness />);

    const input = screen.getByRole("textbox", { name: "Heading" });
    fireEvent.change(input, { target: { value: "Retry Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Rerender" }));

    expect(screen.getByDisplayValue("Retry Title")).toBeDefined();
  });

  it("keeps an external save error visible on blur when the user has not changed the value", () => {
    render(
      <AutoSaveInlineHeading
        ariaLabel="Heading"
        errorMessage="Could not update heading."
        value="Repo Maintainer"
        onSave={async () => {}}
        validate={() => null}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Heading" });
    fireEvent.blur(input);

    expect(screen.getByRole("textbox", { name: "Heading" })).toBeDefined();
    expect(screen.getByText("Could not update heading.")).toBeDefined();
  });

  it("restores the persisted value when escape cancels a changed draft after a parent-owned save error", () => {
    render(
      <AutoSaveInlineHeading
        ariaLabel="Heading"
        errorMessage="Could not update heading."
        value="Repo Maintainer"
        onSave={async () => {}}
        validate={() => null}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Heading" });
    fireEvent.change(input, { target: { value: "Retry Title" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.getByRole("textbox", { name: "Heading" })).toHaveProperty(
      "value",
      "Repo Maintainer",
    );
  });

  it("preserves the retry draft when an external save error is cleared before retry", async () => {
    function RetryHarness(): React.JSX.Element {
      const [value, setValue] = useState("Repo Maintainer");
      const [errorState, setErrorState] = useState<{
        kind: "save";
        message: string;
      } | null>({
        kind: "save",
        message: "Could not update heading.",
      });

      return (
        <AutoSaveInlineHeading
          ariaLabel="Heading"
          value={value}
          onSave={async (nextValue) => {
            setErrorState(null);
            setValue(nextValue);
          }}
          successFadeDurationMs={20}
          successVisibleDurationMs={40}
          validate={() => null}
          {...(errorState === null ? {} : { errorMessage: errorState.message })}
        />
      );
    }

    render(<RetryHarness />);

    const input = screen.getByRole("textbox", { name: "Heading" });
    fireEvent.change(input, { target: { value: "Retry Title" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Heading" })).toHaveProperty(
        "value",
        "Retry Title",
      );
    });
  });

  it("ignores a stale save result after the parent resets the value", async () => {
    let resolveSave: (() => void) | undefined;

    function ResetHarness(): React.JSX.Element {
      const [value, setValue] = useState("Repo Maintainer");

      return (
        <div>
          <button
            onClick={() => {
              setValue("Server Title");
            }}
            type="button"
          >
            Reset
          </button>
          <AutoSaveInlineHeading
            ariaLabel="Heading"
            value={value}
            onSave={() =>
              new Promise<void>((resolve) => {
                resolveSave = resolve;
              })
            }
            validate={() => null}
          />
        </div>
      );
    }

    render(<ResetHarness />);

    const input = screen.getByRole("textbox", { name: "Heading" });
    fireEvent.change(input, { target: { value: "Client Title" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    const finishSave = resolveSave;
    if (finishSave === undefined) {
      throw new Error("Expected save resolver to be captured.");
    }
    finishSave();

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Heading" })).toHaveProperty(
        "value",
        "Server Title",
      );
    });
  });

  it("does not auto-close a new draft after a prior save succeeded", async () => {
    const clock = createMutableClock(0);
    const scheduler = createManualScheduler(clock);

    render(
      <AutoSaveInlineHeading
        ariaLabel="Heading"
        value="Repo Maintainer"
        onSave={async () => {}}
        scheduler={scheduler}
        successFadeDurationMs={20}
        successVisibleDurationMs={40}
        validate={() => null}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Heading" });
    fireEvent.change(input, { target: { value: "New Title" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(getSaveState({ label: "Heading" })).toBe("saved");
    });
    expect(scheduler.pendingCount()).toBe(2);

    fireEvent.change(screen.getByRole("textbox", { name: "Heading" }), {
      target: { value: "Second Title" },
    });

    expect(getSaveState({ label: "Heading" })).toBe("idle");
    expect(scheduler.pendingCount()).toBe(0);

    clock.advanceMs(40);
    expect(scheduler.runDue()).toBe(0);

    expect(screen.getByRole("textbox", { name: "Heading" })).toHaveProperty(
      "value",
      "Second Title",
    );
  });

  it("preserves the saved confirmation when the parent applies the new value", async () => {
    function ControlledHarness(): React.JSX.Element {
      const [value, setValue] = useState("Repo Maintainer");

      return (
        <AutoSaveInlineHeading
          ariaLabel="Heading"
          onSave={async (nextValue) => {
            setValue(nextValue);
          }}
          successFadeDurationMs={20}
          successVisibleDurationMs={40}
          validate={() => null}
          value={value}
        />
      );
    }

    render(<ControlledHarness />);

    const input = screen.getByRole("textbox", { name: "Heading" });
    fireEvent.change(input, { target: { value: "New Title" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(getSaveState({ label: "Heading" })).toBe("saved");
    });

    expect(screen.getByRole("textbox", { name: "Heading" })).toHaveProperty("value", "New Title");
  });
});

describe("AutoSaveTitleHeading", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the empty display text as placeholder without seeding the input value", () => {
    render(
      <AutoSaveTitleHeading
        ariaLabel="Session title"
        emptyDisplayText="Untitled"
        onSave={async () => {}}
        requiredLabel="Session title"
        value={null}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Session title" });
    expect(input).toHaveProperty("value", "");
    expect(input.getAttribute("placeholder")).toBe("Untitled");
  });

  it("treats blank persisted values like missing titles", () => {
    render(
      <AutoSaveTitleHeading
        ariaLabel="Session title"
        emptyDisplayText="Untitled"
        onSave={async () => {}}
        requiredLabel="Session title"
        value="   "
      />,
    );

    const input = screen.getByRole("textbox", { name: "Session title" });
    expect(input).toHaveProperty("value", "");
    expect(input.getAttribute("placeholder")).toBe("Untitled");
  });

  it("applies the required-label validation message", async () => {
    render(
      <AutoSaveTitleHeading
        ariaLabel="Session title"
        emptyDisplayText="Untitled"
        onSave={async () => {}}
        requiredLabel="Session title"
        value="Existing title"
      />,
    );

    const input = screen.getByRole("textbox", { name: "Session title" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    expect(await screen.findByText("Session title is required.")).toBeDefined();
  });
});
