// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { SessionsPage } from "./sessions-page.js";

describe("SessionsPage", () => {
  it("renders empty-state guidance and actions", () => {
    render(
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Sessions")).toBeDefined();
    expect(screen.getByRole("button", { name: "Open sandbox profiles" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Create profile" })).toBeDefined();
  });
});
