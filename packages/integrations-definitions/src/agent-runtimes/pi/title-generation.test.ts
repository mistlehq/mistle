import { describe, expect, it } from "vitest";

import {
  buildPiConversationTitleGenerationPrompt,
  buildPiConversationTitleGenerationShellScript,
  parsePiConversationTitleGenerationOutput,
} from "./title-generation.js";

const RenderedTriggerInput = "Investigate this failed deploy and summarize the root cause.";

describe("buildPiConversationTitleGenerationPrompt", () => {
  it("uses the delivered input as the title source", () => {
    const prompt = buildPiConversationTitleGenerationPrompt(RenderedTriggerInput);

    expect(prompt).toContain("Return only a JSON object");
    expect(prompt).toContain("Interpret the message or payload");
    expect(prompt).toContain("Use 3-8 words");
    expect(prompt).toContain("Investigate this failed deploy");
    expect(prompt).not.toContain("Webhook context:");
  });
});

describe("buildPiConversationTitleGenerationShellScript", () => {
  it("runs Pi through non-interactive print mode", () => {
    expect(buildPiConversationTitleGenerationShellScript()).toBe(
      "PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 pi --no-session --no-tools --no-context-files --no-skills --no-prompt-templates --no-extensions -p",
    );
  });
});

describe("parsePiConversationTitleGenerationOutput", () => {
  it("normalizes whitespace and strips trailing punctuation", () => {
    expect(parsePiConversationTitleGenerationOutput('{"title":"  Failed   deploy triage! "}')).toBe(
      "Failed deploy triage",
    );
  });

  it("rejects non-JSON output", () => {
    expect(() => parsePiConversationTitleGenerationOutput("Failed deploy triage")).toThrow(
      "Pi conversation title generation returned output that is not valid JSON.",
    );
  });
});
