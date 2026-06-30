import { describe, expect, it } from "vitest";

import { DesignerEvalJudgeResultSchema, renderJudgeResultMarkdown } from "./judge-result.ts";

describe("Designer eval judge result", () => {
  it("validates and renders structured judge output", () => {
    const result = DesignerEvalJudgeResultSchema.parse({
      verdict: "fail",
      failureCategory: "designer_behavior_issue",
      scores: {
        workflowClarity: 2,
        setupCompleteness: 1,
        runtimeCapabilityCorrectness: 1,
        honestHandoff: 2,
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
    expect(renderJudgeResultMarkdown(result)).toContain("designer_behavior_issue");
  });
});
