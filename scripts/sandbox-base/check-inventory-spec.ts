import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { SandboxBaseInventorySpec, type SandboxBaseDockerfileAssertion } from "./inventory-spec.js";

type ParsedDockerfileInstruction = {
  endLine: number;
  flags: readonly string[];
  kind: string;
  startLine: number;
  value: string;
};

type ParsedDockerfileStage = {
  baseImage: string;
  instructions: readonly ParsedDockerfileInstruction[];
  name: string;
};

type ParsedDockerfileFacts = {
  stages: readonly ParsedDockerfileStage[];
};

const ParseDockerfileToolDirectory = new URL("./parse-dockerfile/", import.meta.url);

function parseDockerfileFacts(dockerfileText: string): ParsedDockerfileFacts {
  const output = execFileSync("go", ["run", ".", "--dockerfile", "-"], {
    cwd: ParseDockerfileToolDirectory,
    encoding: "utf8",
    input: dockerfileText,
    stdio: ["pipe", "pipe", "pipe"],
  });

  return parseParsedDockerfileFacts(JSON.parse(output));
}

function parseParsedDockerfileFacts(value: unknown): ParsedDockerfileFacts {
  if (!isRecord(value)) {
    throw new Error("Dockerfile parser returned a non-object payload.");
  }

  return {
    stages: parseArray(value["stages"], parseParsedDockerfileStage, "stages"),
  };
}

function parseParsedDockerfileStage(value: unknown): ParsedDockerfileStage {
  if (!isRecord(value)) {
    throw new Error("Dockerfile parser returned a non-object stage.");
  }

  return {
    baseImage: parseString(value["baseImage"], "stage.baseImage"),
    instructions: parseArray(
      value["instructions"],
      parseParsedDockerfileInstruction,
      "stage.instructions",
    ),
    name: parseString(value["name"], "stage.name"),
  };
}

function parseParsedDockerfileInstruction(value: unknown): ParsedDockerfileInstruction {
  if (!isRecord(value)) {
    throw new Error("Dockerfile parser returned a non-object instruction.");
  }

  return {
    endLine: parseNumber(value["endLine"], "instruction.endLine"),
    flags: parseArray(value["flags"], parseStringValue, "instruction.flags"),
    kind: parseString(value["kind"], "instruction.kind"),
    startLine: parseNumber(value["startLine"], "instruction.startLine"),
    value: parseString(value["value"], "instruction.value"),
  };
}

function parseArray<T>(
  value: unknown,
  parseItem: (item: unknown) => T,
  label: string,
): readonly T[] {
  if (!Array.isArray(value)) {
    throw new Error(`Dockerfile parser returned invalid ${label}.`);
  }

  return value.map((item) => parseItem(item));
}

function parseStringValue(value: unknown): string {
  return parseString(value, "string value");
}

function parseString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Dockerfile parser returned invalid ${label}.`);
  }

  return value;
}

function parseNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`Dockerfile parser returned invalid ${label}.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateDockerfileAssertion(
  facts: ParsedDockerfileFacts,
  assertion: SandboxBaseDockerfileAssertion,
): string | null {
  const stage = findStage(facts, assertion.stageName);
  if (stage === null) {
    return `stage '${assertion.stageName}' does not exist`;
  }

  if (assertion.kind === "apt-package") {
    return hasAptPackage(stage, assertion.packageName)
      ? null
      : `expected apt package '${assertion.packageName}' in stage '${assertion.stageName}'`;
  }

  if (assertion.kind === "copy-from-stage") {
    return hasCopyFromStage(stage, assertion)
      ? null
      : `expected COPY --from=${assertion.fromStageName} ${assertion.sourcePath} ${assertion.targetPath} in stage '${assertion.stageName}'`;
  }

  if (assertion.kind === "run-contains") {
    return hasRunContainingText(stage, assertion.expectedText)
      ? null
      : `expected RUN containing '${assertion.expectedText}' in stage '${assertion.stageName}'`;
  }

  return hasSymlink(stage, assertion.sourcePath, assertion.targetPath)
    ? null
    : `expected symlink '${assertion.sourcePath}' -> '${assertion.targetPath}' in stage '${assertion.stageName}'`;
}

function findStage(facts: ParsedDockerfileFacts, stageName: string): ParsedDockerfileStage | null {
  return facts.stages.find((stage) => stage.name === stageName) ?? null;
}

function hasAptPackage(stage: ParsedDockerfileStage, packageName: string): boolean {
  return stage.instructions.some(
    (instruction) =>
      instruction.kind === "RUN" &&
      instruction.value.includes("apt-get install") &&
      splitShellTokens(instruction.value).includes(packageName),
  );
}

function hasCopyFromStage(
  stage: ParsedDockerfileStage,
  assertion: Extract<SandboxBaseDockerfileAssertion, { kind: "copy-from-stage" }>,
): boolean {
  return stage.instructions.some((instruction) => {
    if (instruction.kind !== "COPY") {
      return false;
    }

    const tokens = splitShellTokens(instruction.value);
    return (
      instruction.flags.includes(`--from=${assertion.fromStageName}`) &&
      tokens.includes(assertion.sourcePath) &&
      tokens.includes(assertion.targetPath)
    );
  });
}

function hasRunContainingText(stage: ParsedDockerfileStage, text: string): boolean {
  return stage.instructions.some(
    (instruction) => instruction.kind === "RUN" && instruction.value.includes(text),
  );
}

function hasSymlink(stage: ParsedDockerfileStage, sourcePath: string, targetPath: string): boolean {
  return stage.instructions.some((instruction) => {
    if (instruction.kind !== "RUN") {
      return false;
    }

    const tokens = splitShellTokens(instruction.value);
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index] !== "ln" || tokens[index + 1] !== "-sf") {
        continue;
      }

      if (tokens[index + 2] === sourcePath && tokens[index + 3] === targetPath) {
        return true;
      }
    }

    return false;
  });
}

function splitShellTokens(input: string): readonly string[] {
  return input
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length !== 0 && token !== "&&" && token !== ";");
}

export function findSandboxBaseInventorySpecDrift(dockerfileText: string): readonly string[] {
  const facts = parseDockerfileFacts(dockerfileText);
  const failures: string[] = [];

  for (const tool of SandboxBaseInventorySpec.tools) {
    for (const assertion of tool.dockerfileAssertions) {
      const failure = validateDockerfileAssertion(facts, assertion);
      if (failure !== null) {
        failures.push(`${tool.command}: ${failure}`);
      }
    }
  }

  return failures;
}

function checkInventorySpec(): void {
  const dockerfileUrl = new URL(
    `../../${SandboxBaseInventorySpec.dockerfilePath}`,
    import.meta.url,
  );
  const dockerfileText = readFileSync(dockerfileUrl, "utf8");
  const failures = findSandboxBaseInventorySpecDrift(dockerfileText);

  if (failures.length !== 0) {
    throw new Error(
      [
        `Sandbox base inventory spec drifted from ${SandboxBaseInventorySpec.dockerfilePath}:`,
        ...failures.map((failure) => `- ${failure}`),
      ].join("\n"),
    );
  }

  process.stdout.write(
    `Sandbox base inventory spec matches ${SandboxBaseInventorySpec.dockerfilePath}.\n`,
  );
}

const entrypointUrl = process.argv[1] === undefined ? null : pathToFileURL(process.argv[1]).href;

if (entrypointUrl === import.meta.url) {
  checkInventorySpec();
}
