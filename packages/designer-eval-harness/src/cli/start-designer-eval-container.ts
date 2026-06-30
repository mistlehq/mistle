import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { systemScheduler } from "@mistle/time";

import { getDesignerEvalCase } from "../cases/registry.ts";
import {
  DefaultDesignerEvalConfigPath,
  loadDesignerEvalConfig,
  type DesignerEvalCodexAuth,
} from "../config/designer-eval-config.ts";
import { createDesignerEvalSessionState } from "../control-plane/in-memory-state.ts";
import { startDesignerEvalContainer } from "../docker/designer-eval-container.ts";
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
    runKey: "docker_runtime",
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

  const materializedFiles = await materializeDesignerRuntimeFiles({
    files: codexClient.setup.files,
    outputDir: options.outputDir,
  });
  const startedContainer = await startDesignerEvalContainer({
    runtimeClient: resolveDesignerEvalCodexRuntimeClient(runtimePlan),
    materializedFiles,
    bindMounts: await resolveCodexAuthBindMounts({
      codexAuth: options.codexAuth ?? evalConfig.codex.auth,
      codexAuthPath:
        options.codexAuthPath ??
        evalConfig.codex.authPath ??
        resolve(homedir(), ".codex/auth.json"),
    }),
    ...(options.containerName === undefined ? {} : { containerName: options.containerName }),
    startupTimeoutMs: options.startupTimeoutMs,
  });

  console.log(`Designer eval container started: ${startedContainer.websocketUrl}`);
  console.log(`Websocket bearer token: ${startedContainer.websocketAuthToken}`);
  console.log("Press Ctrl-C to stop it.");

  await waitForShutdown();
  await startedContainer.stop();
}

function parseArgs(args: readonly string[]): {
  caseId: string;
  configPath: string;
  codexAuth?: DesignerEvalCodexAuth;
  codexAuthPath?: string;
  containerName?: string;
  designerSessionId: string;
  organizationId: string;
  outputDir: string;
  prompt: string;
  startupTimeoutMs: number;
} {
  let caseId = "github-pr-review-basic";
  let configPath = DefaultDesignerEvalConfigPath;
  let codexAuth: DesignerEvalCodexAuth | undefined;
  let codexAuthPath: string | undefined;
  let containerName: string | undefined;
  let designerSessionId = "dsn_eval_docker_runtime";
  let organizationId = "org_eval_docker_runtime";
  let outputDir = resolve(RepositoryRootPath, ".local/designer-evals/docker-runtime-files");
  let prompt = "Help me build an agent that reviews GitHub pull requests.";
  let startupTimeoutMs = 60_000;

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
    if (arg === "--codex-auth" && next !== undefined) {
      codexAuth = parseCodexAuth(next);
      index += 1;
      continue;
    }
    if (arg === "--codex-auth-path" && next !== undefined) {
      codexAuthPath = resolveRepositoryPath(next);
      index += 1;
      continue;
    }
    if (arg === "--container-name" && next !== undefined) {
      containerName = next;
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
    if (arg === "--startup-timeout-ms" && next !== undefined) {
      startupTimeoutMs = parsePositiveInteger(next, "--startup-timeout-ms");
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
    ...(codexAuth === undefined ? {} : { codexAuth }),
    ...(codexAuthPath === undefined ? {} : { codexAuthPath }),
    ...(containerName === undefined ? {} : { containerName }),
    designerSessionId,
    organizationId,
    outputDir,
    prompt,
    startupTimeoutMs,
  };
}

async function resolveCodexAuthBindMounts(input: {
  codexAuth: DesignerEvalCodexAuth;
  codexAuthPath: string;
}): Promise<readonly [{ source: string; target: string; mode: "ro" }] | readonly []> {
  if (input.codexAuth === "none") {
    return [];
  }

  await access(input.codexAuthPath);
  return [
    {
      source: input.codexAuthPath,
      target: "/root/.codex/auth.json",
      mode: "ro",
    },
  ];
}

function parseCodexAuth(value: string): DesignerEvalCodexAuth {
  if (value === "local" || value === "none") {
    return value;
  }

  throw new Error("--codex-auth must be 'local' or 'none'.");
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

async function waitForShutdown(): Promise<void> {
  const keepAlive = systemScheduler.schedule(() => {}, 24 * 60 * 60 * 1000);
  try {
    await new Promise<void>((resolveShutdown) => {
      const resolveOnce = (): void => {
        process.off("SIGINT", resolveOnce);
        process.off("SIGTERM", resolveOnce);
        resolveShutdown();
      };
      process.once("SIGINT", resolveOnce);
      process.once("SIGTERM", resolveOnce);
    });
  } finally {
    systemScheduler.cancel(keepAlive);
  }
}

function printHelp(): void {
  console.log(`Usage: pnpm designer:eval:docker-runtime --output-dir <dir>

Options:
  --case-id <id>                Eval case id. Defaults to github-pr-review-basic.
  --config <path>               Designer eval config path. Defaults to ${DefaultDesignerEvalConfigPath}.
  --codex-auth local|none       Override eval config Codex auth mode.
  --codex-auth-path <path>      Local Codex auth file. Defaults to config auth_path or ~/.codex/auth.json.
  --container-name <name>       Optional Docker container name.
  --designer-session-id <id>    Designer session id for MCP credential config.
  --organization-id <id>        Organization id for runtime artifact refs.
  --output-dir <dir>            Local runtime file output directory.
  --prompt <text>               Initial Designer prompt.
  --startup-timeout-ms <ms>     Docker container startup timeout. Defaults to 60000.
`);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
