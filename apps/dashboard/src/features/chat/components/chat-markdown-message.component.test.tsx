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

  it("preserves single newlines as visible line breaks", () => {
    const { container } = render(
      <ChatMarkdownMessage
        isStreaming={false}
        preserveSoftLineBreaks
        text={
          "Repository: mistlehq/mistle.dev\nEvent type: github.issue_comment.created\nAuthor: jlowhy"
        }
      />,
    );

    expect(screen.getByText(/Repository: mistlehq\/mistle\.dev/)).toBeDefined();
    expect(container.querySelectorAll("br")).toHaveLength(2);
  });

  it("renders single newlines as normal markdown soft breaks by default", () => {
    const { container } = render(
      <ChatMarkdownMessage
        isStreaming={false}
        text={
          "Repository: mistlehq/mistle.dev\nEvent type: github.issue_comment.created\nAuthor: jlowhy"
        }
      />,
    );

    expect(screen.getByText(/Repository: mistlehq\/mistle\.dev/)).toBeDefined();
    expect(container.querySelectorAll("br")).toHaveLength(0);
  });

  it("renders markdown task lists with native checkboxes", () => {
    render(
      <ChatMarkdownMessage
        isStreaming={false}
        text={"- [x] Completed task\n- [ ] Remaining task"}
      />,
    );

    const completedTaskItem = screen.getByText("Completed task").closest("li");
    const remainingTaskItem = screen.getByText("Remaining task").closest("li");

    expect(completedTaskItem).not.toBeNull();
    expect(remainingTaskItem).not.toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });
});
