import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { renderEvaluationMarkdown } from "../evaluator/evaluator.ts";
import type {
  DesignerEvalDashboardControlAction,
  DesignerEvalProductState,
  DesignerEvalResult,
} from "../types.ts";

type DesignerEvalBlueprintDashboardControlAction = {
  sequence: number;
  kind: "show_designer_canvas_tab";
  tabKind: "blueprint";
  input: unknown;
  response: unknown;
};

export type DesignerEvalArtifacts = {
  artifactDir: string;
  writeRawEvent: (event: unknown) => Promise<void>;
  writeDashboardAction: (action: DesignerEvalDashboardControlAction) => Promise<void>;
  writeInputResponse: (response: unknown) => Promise<void>;
  writeProductStateBefore: (state: DesignerEvalProductState) => Promise<void>;
  writeProductStateAfter: (state: DesignerEvalProductState) => Promise<void>;
  writeTranscript: (input: { markdown: string; rawThread: unknown }) => Promise<void>;
  writeEvaluation: (result: DesignerEvalResult) => Promise<void>;
};

export async function createDesignerEvalArtifacts(input: {
  artifactRoot: string;
  caseId: string;
  runDate: string;
  runKey: string;
}): Promise<DesignerEvalArtifacts> {
  const artifactDir = join(input.artifactRoot, input.runDate, input.caseId, input.runKey);
  const blueprintDir = join(artifactDir, "blueprints");
  let blueprintSnapshotCount = 0;

  await mkdir(blueprintDir, { recursive: true });
  await Promise.all([
    writeFile(join(artifactDir, "transcript.raw.jsonl"), "", "utf8"),
    writeFile(join(artifactDir, "dashboard-control-actions.jsonl"), "", "utf8"),
    writeFile(join(blueprintDir, "index.jsonl"), "", "utf8"),
  ]);

  return {
    artifactDir,
    writeRawEvent: async (event) => {
      await appendJsonl(join(artifactDir, "transcript.raw.jsonl"), event);
    },
    writeDashboardAction: async (action) => {
      await appendJsonl(join(artifactDir, "dashboard-control-actions.jsonl"), action);
      if (isBlueprintAction(action)) {
        blueprintSnapshotCount += 1;
        await writeBlueprintSnapshot({
          action,
          artifactDir,
          blueprintDir,
          snapshotIndex: blueprintSnapshotCount,
        });
      }
    },
    writeInputResponse: async (response) => {
      await appendJsonl(join(artifactDir, "input-responses.jsonl"), response);
    },
    writeProductStateBefore: async (state) => {
      await writeJson(join(artifactDir, "product-state-before.json"), state);
    },
    writeProductStateAfter: async (state) => {
      await writeJson(join(artifactDir, "product-state-after.json"), state);
    },
    writeTranscript: async (transcript) => {
      await Promise.all([
        writeFile(join(artifactDir, "transcript.md"), transcript.markdown, "utf8"),
        writeJson(join(artifactDir, "thread-read.json"), transcript.rawThread),
      ]);
    },
    writeEvaluation: async (result) => {
      await writeFile(join(artifactDir, "evaluation.md"), renderEvaluationMarkdown(result), "utf8");
    },
  };
}

async function writeBlueprintSnapshot(input: {
  action: DesignerEvalBlueprintDashboardControlAction;
  artifactDir: string;
  blueprintDir: string;
  snapshotIndex: number;
}): Promise<void> {
  const filename = `${String(input.snapshotIndex).padStart(4, "0")}-sequence-${String(input.action.sequence).padStart(4, "0")}.json`;
  const relativePath = join("blueprints", filename);
  await writeJson(join(input.artifactDir, relativePath), {
    snapshotIndex: input.snapshotIndex,
    sequence: input.action.sequence,
    input: input.action.input,
  });
  await appendJsonl(join(input.blueprintDir, "index.jsonl"), {
    snapshotIndex: input.snapshotIndex,
    sequence: input.action.sequence,
    path: relativePath,
  });
}

function isBlueprintAction(
  action: DesignerEvalDashboardControlAction,
): action is DesignerEvalBlueprintDashboardControlAction {
  return action.kind === "show_designer_canvas_tab" && action.tabKind === "blueprint";
}

function renderJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, renderJson(value), "utf8");
}

async function appendJsonl(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "a" });
}
