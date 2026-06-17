import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CommandProbeResult = {
  readonly command: readonly string[];
  readonly errorMessage?: string;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
};

export type AgentBootstrapDoctorReport = {
  readonly exitCode: number;
  readonly output: string;
};

const DirectPnpmProbeCommand = ["pnpm", "--version"];
const NixPnpmProbeCommand = ["nix", "develop", "--command", "pnpm", "--version"];
const RepoRootPath = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function createAgentBootstrapDoctorReport(input: {
  readonly directPnpm: CommandProbeResult;
  readonly nixPnpm?: CommandProbeResult;
  readonly expectedPnpmVersion: string;
}): AgentBootstrapDoctorReport {
  const directVersion = parseVersionOutput(input.directPnpm.stdout);
  const directVersionMatches = directVersion === input.expectedPnpmVersion;

  if (input.directPnpm.exitCode === 0 && directVersionMatches) {
    return {
      exitCode: 0,
      output: [
        "Agent bootstrap doctor: repo command shell is usable.",
        "",
        `Direct pnpm: OK (${directVersion})`,
        "",
        "Run repo commands directly, for example:",
        "  pnpm check:fast",
      ].join("\n"),
    };
  }

  const directDiagnostics = formatPnpmProbeDiagnostics(
    "Direct pnpm",
    input.directPnpm,
    input.expectedPnpmVersion,
  );

  if (input.nixPnpm === undefined) {
    return {
      exitCode: 1,
      output: [
        "Agent bootstrap doctor: direct repo commands are not usable.",
        "",
        ...directDiagnostics,
        "",
        "No Nix-wrapped probe result was provided.",
      ].join("\n"),
    };
  }

  const nixVersion = parseVersionOutput(input.nixPnpm.stdout);
  const nixVersionMatches = nixVersion === input.expectedPnpmVersion;

  if (input.nixPnpm.exitCode === 0 && nixVersionMatches) {
    return {
      exitCode: 0,
      output: [
        "Agent bootstrap doctor: repo commands require the Nix development shell.",
        "",
        ...directDiagnostics,
        "",
        `Nix-wrapped pnpm: OK (${nixVersion})`,
        "",
        "Run repo commands through the wrapper, for example:",
        "  nix develop --command pnpm check:fast",
      ].join("\n"),
    };
  }

  return {
    exitCode: 1,
    output: [
      "Agent bootstrap doctor: repo command shell is not usable.",
      "",
      ...directDiagnostics,
      "",
      ...formatPnpmProbeDiagnostics("Nix-wrapped pnpm", input.nixPnpm, input.expectedPnpmVersion),
      "",
      `Expected pnpm version: ${input.expectedPnpmVersion}`,
      "Install or repair Nix, then retry:",
      "  nix develop --command pnpm doctor:agent",
    ].join("\n"),
  };
}

export function readExpectedPnpmVersionFromPackageJsonValue(value: unknown): string {
  if (isJsonObject(value) === false) {
    throw new Error("Root package.json must contain a JSON object.");
  }

  const packageManager = value["packageManager"];
  if (typeof packageManager !== "string") {
    throw new Error("Root package.json must declare packageManager.");
  }

  const prefix = "pnpm@";
  if (packageManager.startsWith(prefix) === false) {
    throw new Error(`Root package.json packageManager must start with ${prefix}.`);
  }

  const version = packageManager.slice(prefix.length);
  if (version.length === 0) {
    throw new Error("Root package.json packageManager must include a pnpm version.");
  }

  return version;
}

function probeCommand(command: readonly string[]): CommandProbeResult {
  const executable = command[0];
  if (executable === undefined) {
    throw new Error("Command probe requires an executable.");
  }

  const result = spawnSync(executable, command.slice(1), {
    cwd: RepoRootPath,
    encoding: "utf8",
  });
  const errorMessage = result.error instanceof Error ? result.error.message : undefined;

  return {
    command,
    ...(errorMessage === undefined ? {} : { errorMessage }),
    exitCode: result.status,
    stderr: normalizeOutput(result.stderr),
    stdout: normalizeOutput(result.stdout),
  };
}

function parseVersionOutput(output: string): string {
  return output.trim().split(/\s+/)[0] ?? "";
}

function formatProbeDiagnostics(label: string, result: CommandProbeResult): string[] {
  const status = result.exitCode === 0 ? "OK" : `failed with exit code ${formatExitCode(result)}`;
  const lines = [`${label}: ${status}`, `  command: ${result.command.join(" ")}`];

  if (result.stdout.length > 0) {
    lines.push(`  stdout: ${indentMultiline(result.stdout)}`);
  }

  if (result.stderr.length > 0) {
    lines.push(`  stderr: ${indentMultiline(result.stderr)}`);
  }

  if (result.errorMessage !== undefined && result.errorMessage.length > 0) {
    lines.push(`  error: ${indentMultiline(result.errorMessage)}`);
  }

  return lines;
}

function formatPnpmProbeDiagnostics(
  label: string,
  result: CommandProbeResult,
  expectedPnpmVersion: string,
): string[] {
  if (result.exitCode !== 0) {
    return formatProbeDiagnostics(label, result);
  }

  const actualPnpmVersion = parseVersionOutput(result.stdout);
  const status =
    actualPnpmVersion === expectedPnpmVersion
      ? "OK"
      : `reached unexpected pnpm version ${actualPnpmVersion}`;
  const lines = [`${label}: ${status}`, `  command: ${result.command.join(" ")}`];

  if (result.stdout.length > 0) {
    lines.push(`  stdout: ${indentMultiline(result.stdout)}`);
  }

  if (result.stderr.length > 0) {
    lines.push(`  stderr: ${indentMultiline(result.stderr)}`);
  }

  return lines;
}

function formatExitCode(result: CommandProbeResult): string {
  return result.exitCode === null ? "unavailable" : result.exitCode.toString();
}

function indentMultiline(value: string): string {
  return value.replace(/\n/g, "\n          ");
}

function normalizeOutput(value: string | Buffer | undefined): string {
  if (value === undefined) {
    return "";
  }

  const stringValue = typeof value === "string" ? value : value.toString("utf8");
  return stringValue.trim();
}

function readExpectedPnpmVersion(): string {
  return readExpectedPnpmVersionFromPackageJsonValue(
    JSON.parse(readFileSync(resolve(RepoRootPath, "package.json"), "utf8")),
  );
}

function isJsonObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function main(): void {
  const expectedPnpmVersion = readExpectedPnpmVersion();
  const directPnpm = probeCommand(DirectPnpmProbeCommand);
  const directReport = createAgentBootstrapDoctorReport({ directPnpm, expectedPnpmVersion });
  const report =
    directReport.exitCode === 0
      ? directReport
      : createAgentBootstrapDoctorReport({
          directPnpm,
          expectedPnpmVersion,
          nixPnpm: probeCommand(NixPnpmProbeCommand),
        });

  const write = report.exitCode === 0 ? console.log : console.error;
  write(report.output);
  process.exit(report.exitCode);
}

const CurrentFilePath = fileURLToPath(import.meta.url);
const EntrypointPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);

if (EntrypointPath === CurrentFilePath) {
  main();
}
