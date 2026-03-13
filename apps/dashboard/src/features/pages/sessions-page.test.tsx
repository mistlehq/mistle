// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { SessionsPage } from "./sessions-page.js";

describe("SessionsPage", () => {
  it("renders sandbox launcher controls", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    try {
      expect(screen.getByText("Start a new session")).toBeDefined();
      expect(screen.getByRole("combobox", { name: "Sandbox profile" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Start session" })).toBeDefined();
      expect(screen.queryByText("Recent Sessions")).toBeNull();
      expect(screen.queryByText("No launched sessions yet.")).toBeNull();
    } finally {
      rendered.unmount();
      await queryClient.cancelQueries();
      queryClient.clear();
    }
  });
});
