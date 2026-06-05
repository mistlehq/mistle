// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatUserMessage } from "./chat-user-message.js";

describe("ChatUserMessage", () => {
  it("preserves single newlines as visible line breaks", () => {
    const { container } = render(
      <ChatUserMessage
        text={
          "Repository: mistlehq/mistle.dev\nEvent type: github.issue_comment.created\nAuthor: jlowhy"
        }
      />,
    );

    expect(screen.getByText(/Repository: mistlehq\/mistle\.dev/)).toBeDefined();
    expect(container.querySelectorAll("br")).toHaveLength(2);
  });

  it("presents provider-labeled JSON input without rendering the raw compact payload", () => {
    const originalText =
      'Provider payload.event: {"type":"message.created","text":"keep this inside JSON","requestId":"req_123"}';
    const { container } = render(<ChatUserMessage formatTriggerInput text={originalText} />);

    expect(screen.getByText("Provider payload.event:")).toBeTruthy();
    expect(screen.queryByText("keep this inside JSON")).toBeNull();
    expect(container.querySelector("details")).toBeNull();
    expect(screen.queryByText(originalText)).toBeNull();
    expect(getJsonBlockText(container)).toContain('"text": "keep this inside JSON"');
  });

  it("presents valid raw JSON objects with inline pretty JSON", () => {
    const originalText = '{"text":"run this","channel":"C123"}';
    const { container } = render(<ChatUserMessage formatTriggerInput text={originalText} />);

    expect(screen.queryByText("JSON object")).toBeNull();
    expect(screen.queryByText("run this")).toBeNull();
    expect(screen.queryByText("Original input")).toBeNull();
    expect(screen.queryByText("Pretty JSON")).toBeNull();
    expect(screen.queryByText(originalText)).toBeNull();
    expect(getJsonBlockText(container)).toContain('"channel": "C123"');
    expect(container.querySelector('[data-chat-json-token="key"]')?.textContent).toBe('"text"');
    expect(container.querySelector('[data-chat-json-token="string"]')?.textContent).toBe(
      '"run this"',
    );
  });

  it("does not render a field-count message for JSON objects without a message field", () => {
    const { container } = render(
      <ChatUserMessage
        formatTriggerInput
        text='{"event":"session.bootstrap","payload":{"id":"req_123"}}'
      />,
    );

    expect(screen.queryByText("JSON object")).toBeNull();
    expect(screen.queryByText("2 fields")).toBeNull();
    expect(getJsonBlockText(container)).toContain('"event": "session.bootstrap"');
  });

  it("renders prose and embedded JSON in the authored order", () => {
    const { container } = render(
      <ChatUserMessage
        formatTriggerInput
        text='Please investigate this issue here {"issue":{"key":"MST-123"}} and then fix it'
      />,
    );

    expect(screen.queryByText("JSON object")).toBeNull();
    expect(screen.queryByText(/Context:/)).toBeNull();
    expect(screen.getByText("Please investigate this issue here")).toBeTruthy();
    expect(getJsonBlockText(container)).toContain('"key": "MST-123"');
    expect(screen.getByText("and then fix it")).toBeTruthy();

    const presentation = container.querySelector("[data-chat-trigger-input-presentation]");
    expect(presentation?.textContent).toContain(
      'Please investigate this issue here{\n  "issue": {\n    "key": "MST-123"\n  }\n}and then fix it',
    );
  });

  it("keeps Markdown fenced JSON messages on the Markdown rendering path", () => {
    const originalText = [
      "Please use this:",
      "```json",
      '{"text":"keep this as code"}',
      "```",
      "Thanks.",
    ].join("\n");
    const { container } = render(<ChatUserMessage text={originalText} />);

    expect(container.querySelector("[data-chat-trigger-input-presentation]")).toBeNull();
    expect(container.querySelector("code")?.textContent).toContain('{"text":"keep this as code"}');
  });

  it("keeps ordinary JSON-containing user messages on the Markdown rendering path", () => {
    const originalText = 'Please inspect {"issue":{"key":"MST-123"}} and summarize it.';
    const { container } = render(<ChatUserMessage text={originalText} />);

    expect(container.querySelector("[data-chat-trigger-input-presentation]")).toBeNull();
    expect(screen.getByText(originalText)).toBeTruthy();
  });
});

function getJsonBlockText(container: HTMLElement): string {
  const block = container.querySelector("pre");
  if (block === null) {
    throw new Error("Expected a JSON block to be rendered.");
  }

  return block.textContent ?? "";
}
