import { z } from "zod";

import type { DesignerEvalJudgeResult } from "../types.ts";

export const DesignerEvalJudgeResultSchema: z.ZodType<DesignerEvalJudgeResult> = z
  .object({
    verdict: z.enum(["pass", "fail", "inconclusive"]),
    failureCategory: z.enum([
      "none",
      "harness_issue",
      "designer_behavior_issue",
      "product_capability_gap",
      "ambiguous_case",
    ]),
    scores: z
      .object({
        conversationFlow: z.number().int().min(1).max(4),
        factoryProcessClarity: z.number().int().min(1).max(4),
        agentRoleSeparation: z.number().int().min(1).max(4),
        feedbackLoopQuality: z.number().int().min(1).max(4),
        readinessDisclosure: z.number().int().min(1).max(4),
      })
      .strict(),
    findings: z.array(
      z
        .object({
          severity: z.enum(["low", "medium", "high"]),
          category: z.enum([
            "harness_issue",
            "designer_behavior_issue",
            "product_capability_gap",
            "ambiguous_case",
          ]),
          evidence: z.string().min(1),
          suggestedFix: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export function renderJudgeResultMarkdown(result: DesignerEvalJudgeResult): string {
  const findingLines =
    result.findings.length === 0
      ? ["- No findings."]
      : result.findings.map(
          (finding) =>
            `- ${finding.severity} ${finding.category}: ${finding.evidence} Suggested fix: ${finding.suggestedFix}`,
        );

  return [
    "# Designer Eval Judge Result",
    "",
    `Verdict: ${result.verdict}`,
    `Failure category: ${result.failureCategory}`,
    "",
    "## Scores",
    "",
    `- Conversation flow: ${String(result.scores.conversationFlow)}/4`,
    `- Factory process clarity: ${String(result.scores.factoryProcessClarity)}/4`,
    `- Agent role separation: ${String(result.scores.agentRoleSeparation)}/4`,
    `- Feedback loop quality: ${String(result.scores.feedbackLoopQuality)}/4`,
    `- Readiness disclosure: ${String(result.scores.readinessDisclosure)}/4`,
    "",
    "## Findings",
    "",
    ...findingLines,
    "",
  ].join("\n");
}
