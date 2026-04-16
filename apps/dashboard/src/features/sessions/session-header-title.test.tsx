// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SessionHeaderTitle } from "./session-header-title.js";
import { sandboxInstanceStatusQueryKey } from "./sessions-query-keys.js";

describe("SessionHeaderTitle", () => {
  afterEach(() => {
    cleanup();
  });

  function renderSessionHeaderTitle(input: { title: string | null }): QueryClient {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sandboxInstanceStatusQueryKey("sbi_123"), {
      id: "sbi_123",
      title: input.title,
      status: "running",
      connectable: true,
      failureCode: null,
      failureMessage: null,
      runtimePlan: null,
      automationConversation: null,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SessionHeaderTitle sandboxInstanceId="sbi_123" />
      </QueryClientProvider>,
    );

    return queryClient;
  }

  it("renders the cached title in an inline editable field", () => {
    renderSessionHeaderTitle({
      title: "Investigate flaky title rendering",
    });

    const input = screen.getByRole("textbox", { name: "Session title" });

    expect(input).toHaveProperty("value", "Investigate flaky title rendering");
    expect(input.className).toContain("h-7");
    expect(input.className).toContain("text-sm");
    expect(input.className).toContain("truncate");
  });

  it("shows validation feedback when the edited title is blank", async () => {
    renderSessionHeaderTitle({
      title: "Investigate flaky title rendering",
    });

    const input = screen.getByRole("textbox", { name: "Session title" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    expect(await screen.findByText("Session title is required.")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Session title" })).toBeDefined();
  });

  it("uses Untitled as the placeholder for blank persisted titles", () => {
    renderSessionHeaderTitle({
      title: "   ",
    });

    expect(screen.getByRole("textbox", { name: "Session title" }).getAttribute("placeholder")).toBe(
      "Untitled",
    );
  });
});
