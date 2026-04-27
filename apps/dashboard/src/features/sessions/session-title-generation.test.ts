import { describe, expect, it } from "vitest";

import {
  buildSessionTitleGenerationPrompt,
  normalizeGeneratedSessionTitle,
  parseSessionTitleGenerationOutput,
} from "./session-title-generation.js";

describe("session title generation", () => {
  it("builds a prompt around the message payload", () => {
    const prompt = buildSessionTitleGenerationPrompt("Fix the session startup error");

    expect(prompt).toContain("Return only a JSON object");
    expect(prompt).toContain("Interpret the message or payload");
    expect(prompt).toContain("Message or payload:");
    expect(prompt).toContain("Fix the session startup error");
  });

  it("parses and normalizes a generated title", () => {
    expect(parseSessionTitleGenerationOutput('{"title":" Fix   startup error. "}')).toBe(
      "Fix startup error",
    );
  });

  it("rejects non-json output", () => {
    expect(() => parseSessionTitleGenerationOutput("Fix startup error")).toThrow(
      "Codex title generation returned",
    );
  });

  it("caps long generated titles", () => {
    expect(
      normalizeGeneratedSessionTitle(
        "Investigate the unexpectedly long sandbox session startup failure title",
      ),
    ).toBe("Investigate the unexpectedly long sandbox session");
  });
});
