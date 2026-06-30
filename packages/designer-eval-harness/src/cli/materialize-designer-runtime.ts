import { resolve } from "node:path";

import { getDesignerEvalCase } from "../cases/registry.ts";
import {
  DefaultDesignerEvalConfigPath,
  loadDesignerEvalConfig,
} from "../config/designer-eval-config.ts";
import { createDesignerEvalSessionState } from "../control-plane/in-memory-state.ts";
import { compileEvalDesignerRuntime } from "../runtime/compile-eval-designer-runtime.ts";
import { materializeDesignerRuntimeFiles } from "../runtime/materialize-runtime-files.ts";
import { resolveDesignerEvalCodexRuntimeClient } from "../runtime/resolve-codex-runtime-client.ts";
import { RepositoryRootPath, resolveRepositoryPath } from "./paths.ts";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const evalConfig = loadDesignerEvalConfig({
    configPath: options.configPath,
  });
  const evalCase = getDesignerEvalCase(options.caseId);
  const state = createDesignerEvalSessionState({
    evalCase,
    runKey: "runtime_materialization",
  });
  const runtimePlan = compileEvalDesignerRuntime({
    availableProviderResources: state.productState.availableProviderResources,
    config: evalConfig,
    designerSessionId: options.designerSessionId,
    initialPrompt: options.prompt,
    openAiProviderMode: "local_subscription",
    organizationId: options.organizationId,
    seededState: state.seededState,
  });
  const codexClient = runtimePlan.runtimeClients.find(
    (runtimeClient) => runtimeClient.clientId === "codex-cli",
  );
  if (codexClient === undefined) {
    throw new Error("Designer runtime plan did not include the codex-cli runtime client.");
  }

  const materialized = await materializeDesignerRuntimeFiles({
    files: codexClient.setup.files,
    outputDir: options.outputDir,
  });
  const dockerRuntimeClient = resolveDesignerEvalCodexRuntimeClient(runtimePlan);

  console.log(`Materialized ${String(materialized.length)} Designer runtime file(s).`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`Image: ${dockerRuntimeClient.imageRef}`);
  console.log(`Command: ${dockerRuntimeClient.command.join(" ")}`);
  for (const file of materialized) {
    console.log(`- ${file.fileId}: ${file.runtimePath} -> ${file.localPath}`);
  }
}

function parseArgs(args: readonly string[]): {
  caseId: string;
  configPath: string;
  designerSessionId: string;
  organizationId: string;
  outputDir: string;
  prompt: string;
} {
  let caseId = "github-pr-review-basic";
  let configPath = DefaultDesignerEvalConfigPath;
  let designerSessionId = "dsn_eval_runtime_materialization";
  let organizationId = "org_eval_runtime_materialization";
  let outputDir = resolve(RepositoryRootPath, ".local/designer-evals/runtime-files");
  let prompt = "Help me build an agent that reviews GitHub pull requests.";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--case-id" && next !== undefined) {
      caseId = next;
      index += 1;
      continue;
    }
    if (arg === "--config" && next !== undefined) {
      configPath = resolveRepositoryPath(next);
      index += 1;
      continue;
    }
    if (arg === "--designer-session-id" && next !== undefined) {
      designerSessionId = next;
      index += 1;
      continue;
    }
    if (arg === "--organization-id" && next !== undefined) {
      organizationId = next;
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next !== undefined) {
      outputDir = resolveRepositoryPath(next);
      index += 1;
      continue;
    }
    if (arg === "--prompt" && next !== undefined) {
      prompt = next;
      index += 1;
      continue;
    }
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown or incomplete argument '${arg ?? ""}'.`);
  }

  return {
    caseId,
    configPath,
    designerSessionId,
    organizationId,
    outputDir,
    prompt,
  };
}

function printHelp(): void {
  console.log(`Usage: pnpm --filter @mistle/designer-eval-harness runtime:materialize --output-dir <dir>

Options:
  --case-id <id>                Eval case id. Defaults to github-pr-review-basic.
  --config <path>               Designer eval config path. Defaults to ${DefaultDesignerEvalConfigPath}.
  --designer-session-id <id>    Designer session id for MCP credential config.
  --organization-id <id>        Organization id for runtime artifact refs.
  --output-dir <dir>            Local output directory.
  --prompt <text>               Initial Designer prompt.
`);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
