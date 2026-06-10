import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type JsonObject = { readonly [key: string]: unknown };

export type CommandStatus =
  | {
      readonly available: true;
      readonly output: string;
    }
  | {
      readonly available: false;
      readonly detail: string;
    };

type DoctorCheck = {
  readonly label: string;
  readonly status: "ok" | "warning" | "missing" | "blocker";
  readonly detail: string;
};

type DoctorReport = {
  readonly checks: readonly DoctorCheck[];
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
  readonly suggestedCommands: readonly string[];
};

type CommandRunner = (command: string, args: readonly string[]) => CommandStatus;

export type AgentDoctorState = {
  readonly cloudflared: CommandStatus;
  readonly cloudflareTunnelEnvPresent: readonly string[];
  readonly configuredPnpmVersion: string | undefined;
  readonly docker: CommandStatus;
  readonly dockerCompose: CommandStatus;
  readonly localFiles: readonly LocalFileStatus[];
  readonly nix: CommandStatus;
  readonly node: CommandStatus;
  readonly pnpm: CommandStatus;
  readonly runningInsideNix: boolean;
};

type LocalFileStatus = {
  readonly relativePath: string;
  readonly present: boolean;
};

const RepositoryRootPath = fileURLToPath(new URL("../..", import.meta.url));

const LocalConfigFiles = [
  "flake.nix",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "config/config.development.toml",
  ".env.dev",
  ".env.test",
];

export const CloudflareTunnelEnvNames = [
  "CLOUDFLARE_TUNNEL_TOKEN",
  "CONTROL_PLANE_API_TUNNEL_HOSTNAME",
  "DATA_PLANE_API_TUNNEL_HOSTNAME",
];

export function inspectAgentDoctorState(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly runCommand: CommandRunner;
  readonly workspaceRoot: string;
}): AgentDoctorState {
  return {
    cloudflared: input.runCommand("cloudflared", ["--version"]),
    cloudflareTunnelEnvPresent: CloudflareTunnelEnvNames.filter((name) =>
      hasEnvValue(input.env, name),
    ),
    configuredPnpmVersion: readConfiguredPnpmVersion(input.workspaceRoot),
    docker: input.runCommand("docker", ["--version"]),
    dockerCompose: input.runCommand("docker", ["compose", "version"]),
    localFiles: inspectLocalFiles(input.workspaceRoot),
    nix: input.runCommand("nix", ["--version"]),
    node: input.runCommand("node", ["--version"]),
    pnpm: input.runCommand("pnpm", ["--version"]),
    runningInsideNix: isRunningInsideNix(input.env),
  };
}

export function createAgentDoctorReport(state: AgentDoctorState): DoctorReport {
  const checks: DoctorCheck[] = [
    commandCheck("Nix", state.nix),
    {
      label: "Nix shell activation",
      status: state.runningInsideNix ? "ok" : "warning",
      detail: state.runningInsideNix
        ? "Running inside nix develop."
        : "Not running inside nix develop. Use nix develop --command pnpm <command> for repo commands.",
    },
    commandCheck("Node", state.node),
    pnpmCheck(state),
    commandCheck("Docker", state.docker),
    commandCheck("Docker Compose", state.dockerCompose),
    commandCheck("cloudflared", state.cloudflared),
    ...fileChecks(state.localFiles),
    cloudflareTunnelEnvCheck(state.cloudflareTunnelEnvPresent),
  ];

  const blockers = collectBlockers(state);
  const finalChecks: DoctorCheck[] = checks.map((check) =>
    blockers.some((blocker) => blocker.startsWith(`${check.label}:`))
      ? { ...check, status: "blocker" }
      : check,
  );
  const warnings = finalChecks
    .filter((check) => check.status === "warning" || check.status === "missing")
    .map((check) => `${check.label}: ${check.detail}`);

  return {
    checks: finalChecks,
    warnings,
    blockers,
    suggestedCommands: suggestedCommands(state),
  };
}

export function formatAgentDoctorReport(report: DoctorReport): string {
  const lines = ["Mistle agent bootstrap doctor", "", "Checks:"];

  for (const check of report.checks) {
    lines.push(`${markerForStatus(check.status)} ${check.label}: ${check.detail}`);
  }

  if (report.blockers.length > 0) {
    lines.push("", "Blockers:");
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push("", "Suggested next commands:");
  for (const command of report.suggestedCommands) {
    lines.push(`- ${command}`);
  }

  return lines.join("\n");
}

function main(): void {
  const report = createAgentDoctorReport(
    inspectAgentDoctorState({
      workspaceRoot: RepositoryRootPath,
      env: process.env,
      runCommand: runLocalCommand,
    }),
  );

  console.log(formatAgentDoctorReport(report));

  if (report.blockers.length > 0) {
    process.exit(1);
  }
}

function runLocalCommand(command: string, args: readonly string[]): CommandStatus {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    shell: false,
  });

  if (result.status === 0) {
    const output = `${result.stdout}${result.stderr}`.trim();
    return {
      available: true,
      output: output.length > 0 ? (output.split("\n")[0] ?? "") : "available",
    };
  }

  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const detail = `${stderr}${stdout}`.trim();
  return {
    available: false,
    detail:
      detail.length > 0
        ? (detail.split("\n")[0] ?? detail)
        : (result.error?.message ?? `exited with status ${String(result.status)}`),
  };
}

function readConfiguredPnpmVersion(workspaceRoot: string): string | undefined {
  const packageJsonPath = join(workspaceRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }

  const rawPackageJson: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (!isJsonObject(rawPackageJson)) {
    return undefined;
  }

  const packageManager = rawPackageJson["packageManager"];
  if (typeof packageManager === "string" && packageManager.startsWith("pnpm@")) {
    return packageManager.slice("pnpm@".length);
  }

  const engines = rawPackageJson["engines"];
  if (!isJsonObject(engines)) {
    return undefined;
  }

  const pnpmEngine = engines["pnpm"];
  return typeof pnpmEngine === "string" ? pnpmEngine : undefined;
}

function isRunningInsideNix(env: NodeJS.ProcessEnv): boolean {
  return env["IN_NIX_SHELL"] !== undefined && env["IN_NIX_SHELL"].trim().length > 0;
}

function commandCheck(label: string, command: CommandStatus): DoctorCheck {
  if (command.available) {
    return {
      label,
      status: "ok",
      detail: command.output,
    };
  }

  return {
    label,
    status: "missing",
    detail: command.detail,
  };
}

function pnpmCheck(
  input: Pick<AgentDoctorState, "configuredPnpmVersion" | "pnpm" | "runningInsideNix">,
): DoctorCheck {
  if (!input.pnpm.available) {
    return {
      label: "pnpm",
      status: input.runningInsideNix ? "blocker" : "warning",
      detail: input.pnpm.detail,
    };
  }

  const versionDetail =
    input.configuredPnpmVersion === undefined
      ? input.pnpm.output
      : `${input.pnpm.output} (configured ${input.configuredPnpmVersion})`;

  if (
    input.configuredPnpmVersion !== undefined &&
    input.pnpm.output !== input.configuredPnpmVersion
  ) {
    return {
      label: "pnpm",
      status: "warning",
      detail: `${versionDetail}; expected configured package-manager version.`,
    };
  }

  return {
    label: "pnpm",
    status: "ok",
    detail: versionDetail,
  };
}

function inspectLocalFiles(workspaceRoot: string): LocalFileStatus[] {
  return LocalConfigFiles.map((relativePath) => ({
    relativePath,
    present: existsSync(join(workspaceRoot, relativePath)),
  }));
}

function fileChecks(files: readonly LocalFileStatus[]): DoctorCheck[] {
  return files.map((file) => ({
    label: file.relativePath,
    status: file.present ? "ok" : "missing",
    detail: file.present ? "present" : "missing",
  }));
}

function cloudflareTunnelEnvCheck(presentNames: readonly string[]): DoctorCheck {
  const presentNameSet = new Set(presentNames);
  const missingNames = CloudflareTunnelEnvNames.filter((name) => !presentNameSet.has(name));

  if (missingNames.length === 0) {
    return {
      label: "Cloudflare tunnel env",
      status: "ok",
      detail: `present: ${presentNames.join(", ")}`,
    };
  }

  return {
    label: "Cloudflare tunnel env",
    status: "missing",
    detail: `missing: ${missingNames.join(", ")}`,
  };
}

function collectBlockers(
  input: Pick<AgentDoctorState, "nix" | "node" | "pnpm" | "runningInsideNix">,
): string[] {
  const blockers: string[] = [];

  if (!input.node.available) {
    blockers.push(`Node: ${input.node.detail}`);
  }

  if (input.runningInsideNix && !input.pnpm.available) {
    blockers.push(`pnpm: ${input.pnpm.detail}`);
  }

  if (!input.runningInsideNix && !input.pnpm.available && !input.nix.available) {
    blockers.push(
      "pnpm: pnpm is not reachable directly and Nix is unavailable, so local validation cannot run.",
    );
  }

  return blockers;
}

function suggestedCommands(
  input: Pick<AgentDoctorState, "nix" | "pnpm" | "runningInsideNix">,
): string[] {
  if (!input.runningInsideNix && input.nix.available) {
    return [
      "nix develop --command pnpm install",
      "nix develop --command pnpm check:fast",
      "nix develop --command pnpm <command>",
    ];
  }

  if (input.pnpm.available) {
    return ["pnpm install", "pnpm check:fast", "pnpm dev"];
  }

  if (input.runningInsideNix) {
    return [
      "Re-enter the dev shell with nix develop.",
      "If pnpm is still unavailable inside Nix, inspect flake.nix and the Nix shell setup.",
    ];
  }

  return ["Install or enable Nix, then run nix develop --command pnpm <command>."];
}

function hasEnvValue(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name];
  return value !== undefined && value.trim().length > 0;
}

function markerForStatus(status: DoctorCheck["status"]): string {
  switch (status) {
    case "ok":
      return "[ok]";
    case "warning":
      return "[warn]";
    case "missing":
      return "[missing]";
    case "blocker":
      return "[blocker]";
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
