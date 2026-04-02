// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { AutoSaveTextField } from "./auto-save-text-field.js";

describe("AutoSaveTextField", () => {
  afterEach(() => {
    cleanup();
  });

  it("validates and saves on blur, then clears the saved status after it fades", async () => {
    const savedValues: string[] = [];

    render(
      <AutoSaveTextField
        id="display-name"
        initialValue="Mistle Developer"
        label="Display name"
        onSave={async (nextValue) => {
          savedValues.push(nextValue);
        }}
        successFadeDurationMs={20}
        successVisibleDurationMs={40}
        validate={(nextValue) => {
          return nextValue.trim().length === 0 ? "Display name is required." : null;
        }}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Display name" });

    fireEvent.change(input, { target: { value: "Mistle Storybook" } });
    fireEvent.blur(input);

    expect(screen.getByText("Saving", { selector: ".sr-only" })).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Saved", { selector: ".sr-only" })).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.queryByText("Saved", { selector: ".sr-only" })).toBeNull();
    });

    expect(savedValues).toEqual(["Mistle Storybook"]);
  });

  it("shows a validation error without saving when the value is invalid", async () => {
    let saveCount = 0;

    render(
      <AutoSaveTextField
        id="display-name"
        initialValue="Mistle Developer"
        label="Display name"
        onSave={async () => {
          saveCount += 1;
        }}
        validate={(nextValue) => {
          return nextValue.trim().length === 0 ? "Display name is required." : null;
        }}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Display name" });

    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByText("Display name is required.")).toBeTruthy();
    });

    expect(saveCount).toBe(0);
  });

  it("shows a save error when persistence fails", async () => {
    render(
      <AutoSaveTextField
        id="display-name"
        initialValue="Mistle Developer"
        label="Display name"
        onSave={async () => {
          throw new Error("Could not update display name.");
        }}
        validate={() => null}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Display name" });

    fireEvent.change(input, { target: { value: "Mistle Ops" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByText("Could not update display name.")).toBeTruthy();
    });
  });

  it("disables the input while saving", async () => {
    let resolveSave: (() => void) | undefined;

    render(
      <AutoSaveTextField
        id="display-name"
        initialValue="Mistle Developer"
        label="Display name"
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

    const input = screen.getByRole("textbox", { name: "Display name" });
    fireEvent.change(input, { target: { value: "Mistle Storybook" } });
    fireEvent.blur(input);

    expect(screen.getByRole("textbox", { name: "Display name" })).toHaveProperty("disabled", true);

    const finishSave = resolveSave;
    if (finishSave === undefined) {
      throw new Error("Expected save resolver to be captured.");
    }
    finishSave();

    await waitFor(() => {
      expect(screen.queryByText("Saved", { selector: ".sr-only" })).toBeNull();
    });
  });

  it("ignores a stale save result after the field is reset from props", async () => {
    let resolveSave: (() => void) | undefined;

    function ResetHarness(): React.JSX.Element {
      const [value, setValue] = useState("Mistle Developer");

      return (
        <div>
          <button
            onClick={() => {
              setValue("Server Value");
            }}
            type="button"
          >
            Reset
          </button>
          <AutoSaveTextField
            id="display-name"
            initialValue={value}
            label="Display name"
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

    const input = screen.getByRole("textbox", { name: "Display name" });
    fireEvent.change(input, { target: { value: "Client Value" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    const finishSave = resolveSave;
    if (finishSave === undefined) {
      throw new Error("Expected save resolver to be captured.");
    }
    finishSave();

    await waitFor(() => {
      const inputElement = screen.getByRole("textbox", { name: "Display name" });
      expect(inputElement).toHaveProperty("value", "Server Value");
    });

    expect(screen.queryByText("Saved", { selector: ".sr-only" })).toBeNull();
  });
});
