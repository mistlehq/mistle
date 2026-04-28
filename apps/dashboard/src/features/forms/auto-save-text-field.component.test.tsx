// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { AutoSaveTextField } from "./auto-save-text-field.js";

describe("AutoSaveTextField", () => {
  function getSaveState(): string | null {
    return (
      screen
        .getByRole("textbox", { name: "Display name" })
        .closest("[data-save-state]")
        ?.getAttribute("data-save-state") ?? null
    );
  }

  it("validates and saves on blur, then clears the saved status after it fades", async () => {
    const savedValues: string[] = [];

    render(
      <AutoSaveTextField
        id="display-name"
        value="Mistle Developer"
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

    expect(getSaveState()).toBe("saving");

    await waitFor(() => {
      expect(getSaveState()).toBe("saved");
    });

    await waitFor(() => {
      expect(getSaveState()).toBe("idle");
    });

    expect(savedValues).toEqual(["Mistle Storybook"]);
  });

  it("shows a validation error without saving when the value is invalid", async () => {
    let saveCount = 0;

    render(
      <AutoSaveTextField
        id="display-name"
        value="Mistle Developer"
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
        value="Mistle Developer"
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

  it("reverts whitespace-only edits that do not change the trimmed value", () => {
    render(
      <AutoSaveTextField
        id="display-name"
        value="Mistle Developer"
        label="Display name"
        onSave={async () => {}}
        validate={() => null}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Display name" });
    fireEvent.change(input, { target: { value: "  Mistle Developer  " } });
    fireEvent.blur(input);

    expect(screen.getByRole("textbox", { name: "Display name" })).toHaveProperty(
      "value",
      "Mistle Developer",
    );
    expect(getSaveState()).toBe("idle");
  });

  it("disables the input while saving", async () => {
    let resolveSave: (() => void) | undefined;

    function ControlledHarness(): React.JSX.Element {
      const [value, setValue] = useState("Mistle Developer");

      return (
        <AutoSaveTextField
          id="display-name"
          label="Display name"
          onSave={() =>
            new Promise<void>((resolve) => {
              resolveSave = () => {
                setValue("Mistle Storybook");
                resolve();
              };
            })
          }
          successFadeDurationMs={20}
          successVisibleDurationMs={40}
          validate={() => null}
          value={value}
        />
      );
    }

    render(<ControlledHarness />);

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
      expect(getSaveState()).toBe("idle");
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
            value={value}
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

    expect(getSaveState()).toBe("idle");
  });

  it("preserves the saved confirmation when the parent applies the new value", async () => {
    function ControlledHarness(): React.JSX.Element {
      const [value, setValue] = useState("Mistle Developer");

      return (
        <AutoSaveTextField
          id="display-name"
          label="Display name"
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

    const input = screen.getByRole("textbox", { name: "Display name" });
    fireEvent.change(input, { target: { value: "Mistle Storybook" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(getSaveState()).toBe("saved");
    });

    expect(screen.getByRole("textbox", { name: "Display name" })).toHaveProperty(
      "value",
      "Mistle Storybook",
    );
  });
});
