// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatSemanticGroupItemOutput } from "./chat-semantic-group-item-output.js";

describe("ChatSemanticGroupItemOutput", () => {
  it("renders exploring read output through markdown code fences", () => {
    const { container } = render(
      <ChatSemanticGroupItemOutput
        item={{
          id: "read-item-1",
          sourceKind: "command-execution",
          label: "Read",
          detail: "apps/dashboard/src/features/chat/components/chat-thread.tsx",
          sourcePath: "apps/dashboard/src/features/chat/components/chat-thread.tsx",
          detailKind: "code",
          command: "sed -n '1,40p' apps/dashboard/src/features/chat/components/chat-thread.tsx",
          output: [
            "export function ChatThread(): React.JSX.Element {",
            "  return <div />;",
            "}",
          ].join("\n"),
          status: "completed",
        }}
        semanticKind="exploring"
      />,
    );

    expect(container.querySelector("code")).toBeTruthy();
  });

  it("renders searching-web output as a result list", () => {
    render(
      <ChatSemanticGroupItemOutput
        item={{
          id: "search-item-1",
          sourceKind: "web-search",
          label: "Web search",
          detail: "semantic grouping",
          detailKind: "plain",
          command: null,
          output: JSON.stringify({
            results: [
              {
                title: "Semantic grouping in Share.tsx",
                url: "https://example.com/share",
                snippet: "Compact grouped activity rendering.",
              },
            ],
          }),
          status: "completed",
        }}
        semanticKind="searching-web"
      />,
    );

    expect(screen.getByText("Semantic grouping in Share.tsx")).toBeTruthy();
    expect(screen.getByText("https://example.com/share")).toBeTruthy();
  });

  it("falls back to raw output when a web-search payload is not valid json", () => {
    const { container } = render(
      <ChatSemanticGroupItemOutput
        item={{
          id: "search-item-invalid",
          sourceKind: "web-search",
          label: "Web search",
          detail: "semantic grouping",
          detailKind: "plain",
          command: null,
          output: "{invalid json",
          status: "completed",
        }}
        semanticKind="searching-web"
      />,
    );

    expect(container.querySelector("pre")).toBeTruthy();
    expect(screen.getByText("{invalid json")).toBeTruthy();
  });

  it("uses the full source path instead of truncated detail for read rendering", () => {
    const { container } = render(
      <ChatSemanticGroupItemOutput
        item={{
          id: "read-item-truncated",
          sourceKind: "command-execution",
          label: "Read",
          detail: "very/long/path/to/a/component/chat-thread…",
          sourcePath: "very/long/path/to/a/component/chat-thread.md",
          detailKind: "code",
          command: "sed -n '1,40p' very/long/path/to/a/component/chat-thread.md",
          output: "# Heading\n\nContent",
          status: "completed",
        }}
        semanticKind="exploring"
      />,
    );

    expect(container.querySelector("[data-streamdown]")).toBeTruthy();
  });

  it("renders running command output with the command log treatment", () => {
    const { container } = render(
      <ChatSemanticGroupItemOutput
        item={{
          id: "command-item-1",
          sourceKind: "command-execution",
          label: "Command",
          detail: "pnpm lint",
          detailKind: "code",
          command: "pnpm lint",
          output: "Done in 2.3s",
          status: "completed",
        }}
        semanticKind="running-commands"
      />,
    );

    expect(container.querySelector('[data-semantic-output="command-log"]')).toBeTruthy();
  });
});
