// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { RoutedButtonLink } from "./routed-button-link.js";

describe("RoutedButtonLink", () => {
  it("keeps native link semantics while applying button styling", () => {
    render(
      <MemoryRouter>
        <RoutedButtonLink className="custom-action-class" to="/settings" variant="outline">
          Open settings
        </RoutedButtonLink>
      </MemoryRouter>,
    );

    const action = screen.getByRole("link", { name: "Open settings" });

    expect(action.tagName).toBe("A");
    expect(action.getAttribute("href")).toBe("/settings");
    expect(action.getAttribute("role")).toBeNull();
    expect(action.classList.contains("border-border")).toBe(true);
    expect(action.classList.contains("custom-action-class")).toBe(true);
  });
});
