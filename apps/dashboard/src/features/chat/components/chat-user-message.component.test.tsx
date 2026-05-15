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
});
