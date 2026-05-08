#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  DefaultGeneratedConfigPath,
  DefaultGeneratedSecretsPath,
  generateContainerRuntimeConfig,
  stringifyContainerRuntimeConfig,
} from "../container-runtime.js";
import { loadConfig } from "../loader.js";
import { AppIds } from "../modules.js";

type ParsedOptions = {
  configPath: string;
  secretsPath: string;
};

function readOption(input: {
  args: readonly string[];
  name: string;
  defaultValue: string;
}): string {
  const optionIndex = input.args.indexOf(input.name);
  if (optionIndex === -1) {
    return input.defaultValue;
  }

  const value = input.args[optionIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${input.name} requires a value.`);
  }

  return value;
}

function assertNoUnknownOptions(args: readonly string[]): void {
  const knownOptions = new Set(["--output", "--config", "--secrets"]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (!arg.startsWith("--")) {
      continue;
    }

    if (!knownOptions.has(arg)) {
      throw new Error(`Unsupported option: ${arg}`);
    }

    index += 1;
  }
}

function parseOptions(args: readonly string[], env: NodeJS.ProcessEnv): ParsedOptions {
  assertNoUnknownOptions(args);

  const defaultConfigPath =
    env.MISTLE_CONFIG_PATH?.trim() === undefined || env.MISTLE_CONFIG_PATH.trim().length === 0
      ? DefaultGeneratedConfigPath
      : env.MISTLE_CONFIG_PATH.trim();
  const defaultSecretsPath =
    env.MISTLE_GENERATED_SECRETS_PATH?.trim() === undefined ||
    env.MISTLE_GENERATED_SECRETS_PATH.trim().length === 0
      ? DefaultGeneratedSecretsPath
      : env.MISTLE_GENERATED_SECRETS_PATH.trim();

  return {
    configPath: readOption({
      args,
      name: args.includes("--output") ? "--output" : "--config",
      defaultValue: defaultConfigPath,
    }),
    secretsPath: readOption({
      args,
      name: "--secrets",
      defaultValue: defaultSecretsPath,
    }),
  };
}

function generate(args: readonly string[], env: NodeJS.ProcessEnv): void {
  const options = parseOptions(args, env);
  const config = generateContainerRuntimeConfig({
    env,
    secretsPath: options.secretsPath,
  });

  mkdirSync(dirname(options.configPath), { recursive: true });
  writeFileSync(options.configPath, stringifyContainerRuntimeConfig(config), "utf8");
  console.log(`Generated Mistle config: ${options.configPath}`);
}

function validate(args: readonly string[], env: NodeJS.ProcessEnv): void {
  const options = parseOptions(args, env);
  const loadOptions = {
    configPath: options.configPath,
    env,
  };

  loadConfig({ app: AppIds.CONTROL_PLANE_API, ...loadOptions });
  loadConfig({ app: AppIds.CONTROL_PLANE_WORKER, ...loadOptions });
  loadConfig({ app: AppIds.DATA_PLANE_API, ...loadOptions });
  loadConfig({ app: AppIds.DATA_PLANE_GATEWAY, ...loadOptions });
  loadConfig({ app: AppIds.DATA_PLANE_WORKER, ...loadOptions });

  console.log(`Validated Mistle config: ${options.configPath}`);
}

function printUsage(): void {
  console.error(
    [
      "Usage:",
      "  mistle-config generate [--output <path>] [--secrets <path>]",
      "  mistle-config validate [--config <path>]",
    ].join("\n"),
  );
}

function main(args: readonly string[], env: NodeJS.ProcessEnv): void {
  const [command, ...commandArgs] = args;

  if (command === "generate") {
    generate(commandArgs, env);
    return;
  }

  if (command === "validate") {
    validate(commandArgs, env);
    return;
  }

  printUsage();
  throw new Error(command === undefined ? "Missing command." : `Unsupported command: ${command}`);
}

try {
  main(process.argv.slice(2), process.env);
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }

  process.exitCode = 1;
}
