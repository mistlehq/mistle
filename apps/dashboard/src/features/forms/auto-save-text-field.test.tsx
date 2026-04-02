// @vitest-environment jsdom

import { systemSleeper } from "@mistle/time";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
          await systemSleeper.sleep(10);
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
          await systemSleeper.sleep(10);
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
});
