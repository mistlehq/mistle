// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatMarkdownMessage } from "./chat-markdown-message.js";

describe("ChatMarkdownMessage", () => {
  it("renders assistant markdown as structured content", () => {
    render(
      <ChatMarkdownMessage
        isStreaming={false}
        text={"# Directory overview\n\n- .mistle/\n- .mistle/bin/\n\n```sh\nls -la\n```"}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Directory overview" })).toBeDefined();
    expect(screen.getByText(".mistle/")).toBeDefined();
    expect(screen.getByText(".mistle/bin/")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders user markdown content consistently", () => {
    render(
      <ChatMarkdownMessage
        isStreaming={false}
        text={"Use `rg` and summarize:\n\n- apps/dashboard\n- apps/control-plane-api"}
      />,
    );

    expect(
      screen.getByText((_, element) => element?.textContent === "Use rg and summarize:"),
    ).toBeDefined();
    expect(screen.getByText("rg")).toBeDefined();
    expect(screen.getByText("apps/dashboard")).toBeDefined();
    expect(screen.getByText("apps/control-plane-api")).toBeDefined();
  });
});
