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
        workflowClarity: z.number().int().min(1).max(4),
        setupCompleteness: z.number().int().min(1).max(4),
        runtimeCapabilityCorrectness: z.number().int().min(1).max(4),
        honestHandoff: z.number().int().min(1).max(4),
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
    `- Workflow clarity: ${String(result.scores.workflowClarity)}/4`,
    `- Setup completeness: ${String(result.scores.setupCompleteness)}/4`,
    `- Runtime capability correctness: ${String(result.scores.runtimeCapabilityCorrectness)}/4`,
    `- Honest handoff: ${String(result.scores.honestHandoff)}/4`,
    "",
    "## Findings",
    "",
    ...findingLines,
    "",
  ].join("\n");
}
