// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
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

  it("serializes streaming animation across paragraphs and list items", () => {
    const { container } = render(
      <ChatMarkdownMessage
        isStreaming
        text={"Intro paragraph.\n\n- First bullet\n- Second bullet\n\nFinal paragraph."}
      />,
    );

    const animatedChunks = Array.from(container.querySelectorAll("[data-sd-animate]"));
    const introDelayMs = getAnimationDelayMs(animatedChunks, "Intro");
    const firstBulletDelayMs = getAnimationDelayMs(animatedChunks, "First");
    const secondBulletDelayMs = getAnimationDelayMs(animatedChunks, "Second");
    const finalDelayMs = getAnimationDelayMs(animatedChunks, "Final");
    const delaysMs = animatedChunks.map((chunk) => getAnimationDelayFromStyleMs(chunk));
    const firstBulletItemDelayMs = getListItemAnimationDelayMs(container, "First bullet");
    const secondBulletItemDelayMs = getListItemAnimationDelayMs(container, "Second bullet");

    expect(firstBulletDelayMs).toBeGreaterThan(introDelayMs);
    expect(secondBulletDelayMs).toBeGreaterThan(firstBulletDelayMs);
    expect(finalDelayMs).toBeGreaterThan(secondBulletDelayMs);
    expect(firstBulletItemDelayMs).toBe(firstBulletDelayMs);
    expect(secondBulletItemDelayMs).toBe(secondBulletDelayMs);
    expect(delaysMs).toEqual([...delaysMs].sort((left, right) => left - right));
  });

  it("serializes newly appended streaming blocks on rerender", () => {
    const initialText = "Intro paragraph.";
    const { container, rerender } = render(<ChatMarkdownMessage isStreaming text={initialText} />);

    rerender(
      <ChatMarkdownMessage
        isStreaming
        text={`${initialText}\n\n- First bullet\n- Second bullet\n\nFinal paragraph.`}
      />,
    );

    const animatedChunks = Array.from(container.querySelectorAll("[data-sd-animate]"));
    const firstBulletDelayMs = getAnimationDelayMs(animatedChunks, "First");
    const secondBulletDelayMs = getAnimationDelayMs(animatedChunks, "Second");
    const finalDelayMs = getAnimationDelayMs(animatedChunks, "Final");
    const firstBulletItemDelayMs = getListItemAnimationDelayMs(container, "First bullet");
    const secondBulletItemDelayMs = getListItemAnimationDelayMs(container, "Second bullet");

    expect(secondBulletDelayMs).toBeGreaterThan(firstBulletDelayMs);
    expect(finalDelayMs).toBeGreaterThan(secondBulletDelayMs);
    expect(firstBulletItemDelayMs).toBe(firstBulletDelayMs);
    expect(secondBulletItemDelayMs).toBe(secondBulletDelayMs);
  });

  it("does not reanimate text that was visible during an earlier streaming update", async () => {
    const { container, rerender } = render(<ChatMarkdownMessage isStreaming text="Intro" />);

    rerender(<ChatMarkdownMessage isStreaming text="Intro paragraph." />);
    await waitFor(() => {
      expect(container.textContent).toContain("Intro paragraph.");
    });
    const intermediateParagraphChunk = getAnimationChunk(container, "paragraph.");

    rerender(
      <ChatMarkdownMessage
        isStreaming
        text={"Intro paragraph.\n\n- First bullet\n- Second bullet"}
      />,
    );
    await waitFor(() => {
      expect(container.textContent).toContain("Second bullet");
    });

    const animatedChunks = Array.from(container.querySelectorAll("[data-sd-animate]"));
    const introDurationMs = getAnimationDurationMs(animatedChunks, "Intro");
    const firstBulletDelayMs = getAnimationDelayMs(animatedChunks, "First");
    const secondBulletDelayMs = getAnimationDelayMs(animatedChunks, "Second");

    expect(introDurationMs).toBe(0);
    expect(getAnimationChunk(container, "paragraph.")).toBe(intermediateParagraphChunk);
    expect(secondBulletDelayMs).toBeGreaterThan(firstBulletDelayMs);
  });
});

function getAnimationChunk(container: HTMLElement, text: string): Element {
  const matchingChunk = Array.from(container.querySelectorAll("[data-sd-animate]")).find(
    (chunk) => chunk.textContent === text,
  );
  if (matchingChunk === undefined) {
    throw new Error(`Expected an animated chunk for '${text}'.`);
  }

  return matchingChunk;
}

function getAnimationDelayMs(animatedChunks: Element[], text: string): number {
  return getAnimationStyleValueMs(animatedChunks, text, "--sd-delay:");
}

function getAnimationDurationMs(animatedChunks: Element[], text: string): number {
  return getAnimationStyleValueMs(animatedChunks, text, "--sd-duration:");
}

function getAnimationStyleValueMs(
  animatedChunks: Element[],
  text: string,
  property: string,
): number {
  const matchingChunk = animatedChunks.find((chunk) => chunk.textContent === text);
  if (matchingChunk === undefined) {
    throw new Error(`Expected an animated chunk for '${text}'.`);
  }

  return getAnimationValueFromStyleMs(matchingChunk, property);
}

function getListItemAnimationDelayMs(container: HTMLElement, text: string): number {
  const matchingListItem = Array.from(container.querySelectorAll("li")).find((listItem) =>
    listItem.textContent?.includes(text),
  );
  if (matchingListItem === undefined) {
    throw new Error(`Expected a list item containing '${text}'.`);
  }

  return getAnimationValueFromStyleMs(matchingListItem, "--sd-delay:");
}

function getAnimationDelayFromStyleMs(element: Element): number {
  return getAnimationValueFromStyleMs(element, "--sd-delay:");
}

function getAnimationValueFromStyleMs(element: Element, property: string): number {
  const style = element.getAttribute("style");
  if (style === null) {
    throw new Error("Expected animated chunk to include an inline animation style.");
  }

  const delayDeclaration = style
    .split(";")
    .find((declaration) => declaration.trim().startsWith(property));
  if (delayDeclaration === undefined) {
    throw new Error(`Expected animation style to include ${property} ${style}`);
  }

  const delayMsText = delayDeclaration.split(":").at(1)?.trim();
  if (delayMsText === undefined || !delayMsText.endsWith("ms")) {
    throw new Error(`Expected animation delay in milliseconds: ${style}`);
  }

  return Number(delayMsText.slice(0, -2));
}
