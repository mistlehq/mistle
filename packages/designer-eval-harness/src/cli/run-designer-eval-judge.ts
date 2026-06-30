import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getDesignerEvalCase } from "../cases/registry.ts";
import { DesignerEvalJudgeResultSchema, renderJudgeResultMarkdown } from "../judge/judge-result.ts";
import { resolveRepositoryPath } from "./paths.ts";

const PackageRootPath = fileURLToPath(new URL("../../", import.meta.url));

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const artifactDir = options.runDir;
  const evaluationMarkdown = await readTextIfExists(join(artifactDir, "evaluation.md"));
  const caseId =
    options.caseId ??
    readCaseIdFromEvaluation(evaluationMarkdown) ??
    basename(dirname(artifactDir));
  const evalCase = getDesignerEvalCase(caseId);
  const expectedOutcomeMarkdown = await readTextIfExists(
    join(PackageRootPath, evalCase.expectedOutcomePath),
  );
  const judgeInput = renderJudgeInput({
    caseId,
    dashboardActionsJsonl: await readTextIfExists(
      join(artifactDir, "dashboard-control-actions.jsonl"),
    ),
    evaluationMarkdown,
    expectedOutcomeMarkdown,
    latestBlueprintJson: await readLatestBlueprintSnapshot(artifactDir),
    productStateAfterJson: await readTextIfExists(join(artifactDir, "product-state-after.json")),
    productStateBeforeJson: await readTextIfExists(join(artifactDir, "product-state-before.json")),
    transcriptMarkdown: await readTextIfExists(join(artifactDir, "transcript.md")),
  });

  await writeFile(join(artifactDir, "judge-input.md"), judgeInput, "utf8");
  await writeFile(
    join(artifactDir, "judge-result.template.json"),
    renderJudgeResultTemplate(),
    "utf8",
  );

  if (options.resultJsonPath !== undefined) {
    const result = DesignerEvalJudgeResultSchema.parse(
      JSON.parse(await readFile(options.resultJsonPath, "utf8")),
    );
    await Promise.all([
      writeFile(
        join(artifactDir, "judge-result.json"),
        `${JSON.stringify(result, null, 2)}\n`,
        "utf8",
      ),
      writeFile(join(artifactDir, "judge-result.md"), renderJudgeResultMarkdown(result), "utf8"),
    ]);
  }

  console.log(`Wrote judge input: ${join(artifactDir, "judge-input.md")}`);
  console.log(`Wrote judge result template: ${join(artifactDir, "judge-result.template.json")}`);
  if (options.resultJsonPath !== undefined) {
    console.log(`Wrote judge result: ${join(artifactDir, "judge-result.json")}`);
  }
}

function renderJudgeInput(input: {
  caseId: string;
  dashboardActionsJsonl: string;
  evaluationMarkdown: string;
  expectedOutcomeMarkdown: string;
  latestBlueprintJson: string;
  productStateAfterJson: string;
  productStateBeforeJson: string;
  transcriptMarkdown: string;
}): string {
  return [
    "# Designer Eval Judge Input",
    "",
    `Case: ${input.caseId}`,
    "",
    "Apply the judge contract in `docs/judge-contract.md`. Return only JSON matching that contract.",
    "",
    "## Expected Outcome",
    "",
    input.expectedOutcomeMarkdown,
    "",
    "## Deterministic Evaluation",
    "",
    input.evaluationMarkdown,
    "",
    "## Product State Before",
    "",
    "```json",
    input.productStateBeforeJson.trim(),
    "```",
    "",
    "## Product State After",
    "",
    "```json",
    input.productStateAfterJson.trim(),
    "```",
    "",
    "## Latest Blueprint",
    "",
    "```json",
    input.latestBlueprintJson.trim(),
    "```",
    "",
    "## Dashboard Control Actions",
    "",
    "```jsonl",
    input.dashboardActionsJsonl.trim(),
    "```",
    "",
    "## Transcript",
    "",
    input.transcriptMarkdown,
    "",
  ].join("\n");
}

function renderJudgeResultTemplate(): string {
  return `${JSON.stringify(
    {
      verdict: "inconclusive",
      failureCategory: "ambiguous_case",
      scores: {
        conversationFlow: 1,
        factoryProcessClarity: 1,
        agentRoleSeparation: 1,
        feedbackLoopQuality: 1,
        honestHandoff: 1,
      },
      findings: [
        {
          severity: "medium",
          category: "ambiguous_case",
          evidence: "Replace with concrete artifact evidence.",
          suggestedFix:
            "Replace with a specific harness, Designer behavior, or product capability fix.",
        },
      ],
    },
    null,
    2,
  )}\n`;
}

async function readLatestBlueprintSnapshot(artifactDir: string): Promise<string> {
  const indexPath = join(artifactDir, "blueprints", "index.jsonl");
  const indexJsonl = await readTextIfExists(indexPath);
  const lines = indexJsonl
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const latestLine = lines.at(-1);
  if (latestLine === undefined) {
    return "{}";
  }

  const parsed = JSON.parse(latestLine);
  if (typeof parsed !== "object" || parsed === null) {
    return "{}";
  }
  const relativePath = Reflect.get(parsed, "path");
  if (typeof relativePath !== "string") {
    return "{}";
  }

  return await readTextIfExists(join(artifactDir, relativePath));
}

async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return "";
    }
    throw error;
  }
}

function readCaseIdFromEvaluation(evaluationMarkdown: string): string | undefined {
  const match = /^# Designer eval: (?<caseId>[^\n]+)$/mu.exec(evaluationMarkdown);
  return match?.groups?.caseId;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === code;
}

function parseArgs(args: readonly string[]): {
  caseId?: string | undefined;
  resultJsonPath?: string | undefined;
  runDir: string;
} {
  let caseId: string | undefined;
  let resultJsonPath: string | undefined;
  let runDir: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--case" && next !== undefined) {
      caseId = next;
      index += 1;
      continue;
    }
    if (arg === "--result-json" && next !== undefined) {
      resultJsonPath = resolveRepositoryPath(next);
      index += 1;
      continue;
    }
    if (arg === "--run" && next !== undefined) {
      runDir = resolveRepositoryPath(next);
      index += 1;
      continue;
    }
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown or incomplete argument '${arg ?? ""}'.`);
  }

  if (runDir === undefined) {
    throw new Error("--run <artifact-dir> is required.");
  }

  return {
    ...(caseId === undefined ? {} : { caseId }),
    ...(resultJsonPath === undefined ? {} : { resultJsonPath: resolve(resultJsonPath) }),
    runDir,
  };
}

function printHelp(): void {
  console.log(`Usage: pnpm designer:eval:judge --run .local/designer-evals/runs/<date>/<case>/<run>

Options:
  --run <dir>             Eval artifact directory.
  --case <id>             Case id. Defaults to the id in evaluation.md or the artifact parent directory.
  --result-json <path>    Validate and write an LLM-produced judge result JSON.
`);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
