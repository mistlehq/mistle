// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UnavailableResourceState } from "./unavailable-resource-state.js";

describe("UnavailableResourceState", () => {
  it("explains unavailable resources without confirming whether the resource exists", () => {
    render(<UnavailableResourceState />);

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(
      screen.getByText("This page does not exist or you do not have access to it."),
    ).toBeTruthy();
    expect(document.querySelector("[data-slot='empty-content']")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
