import { describe, expect, it } from "vitest";

import { DesignerEvalJudgeResultSchema, renderJudgeResultMarkdown } from "./judge-result.ts";

describe("Designer eval judge result", () => {
  it("validates and renders structured judge output", () => {
    const result = DesignerEvalJudgeResultSchema.parse({
      verdict: "fail",
      failureCategory: "designer_behavior_issue",
      scores: {
        conversationFlow: 1,
        factoryProcessClarity: 2,
        agentRoleSeparation: 1,
        feedbackLoopQuality: 1,
        readinessDisclosure: 2,
      },
      findings: [
        {
          severity: "high",
          category: "designer_behavior_issue",
          evidence:
            "The transcript claims the agent is ready while product state lacks linear-mcp.",
          suggestedFix: "Require Designer to verify provider tools before readiness claims.",
        },
      ],
    });

    expect(renderJudgeResultMarkdown(result)).toContain("Verdict: fail");
    expect(renderJudgeResultMarkdown(result)).toContain("Conversation flow: 1/4");
    expect(renderJudgeResultMarkdown(result)).toContain("Readiness disclosure: 2/4");
    expect(renderJudgeResultMarkdown(result)).toContain("designer_behavior_issue");
  });
});
