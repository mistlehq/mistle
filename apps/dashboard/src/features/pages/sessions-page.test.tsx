// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { SessionsPage, shouldHandleSocketClose } from "./sessions-page.js";

describe("SessionsPage", () => {
  it("handles close events only for the active socket", () => {
    const activeSocket = { id: "active" };
    const staleSocket = { id: "stale" };

    expect(shouldHandleSocketClose(activeSocket, activeSocket)).toBe(true);
    expect(shouldHandleSocketClose(activeSocket, staleSocket)).toBe(false);
    expect(shouldHandleSocketClose(null, staleSocket)).toBe(false);
  });

  it("renders start-session controls and connection status", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText("Start New Session")).toBeDefined();
    expect(screen.getByRole("button", { name: "Start session" })).toBeDefined();
    expect(screen.getByText("Connection Status")).toBeDefined();
  });
});
