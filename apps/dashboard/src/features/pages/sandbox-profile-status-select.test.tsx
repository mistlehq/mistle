// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { SandboxProfileStatus } from "../sandbox-profiles/sandbox-profiles-types.js";
import { SandboxProfileStatusSelect } from "./sandbox-profile-status-select.js";

describe("SandboxProfileStatusSelect", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows title-cased selected value for active state", () => {
    render(
      <SandboxProfileStatusSelect
        disabled={false}
        onValueChange={(_nextValue: SandboxProfileStatus) => {}}
        value="active"
      />,
    );
    const triggerText = screen.getByRole("combobox", {
      name: "Sandbox profile status",
    }).textContent;
    expect(triggerText?.includes("Active")).toBe(true);
    expect(triggerText?.includes("active")).toBe(false);
  });

  it("shows title-cased selected value for inactive state", () => {
    render(
      <SandboxProfileStatusSelect
        disabled={false}
        onValueChange={(_nextValue: SandboxProfileStatus) => {}}
        value="inactive"
      />,
    );
    const triggerText = screen.getByRole("combobox", {
      name: "Sandbox profile status",
    }).textContent;
    expect(triggerText?.includes("Inactive")).toBe(true);
    expect(triggerText?.includes("inactive")).toBe(false);
  });
});
