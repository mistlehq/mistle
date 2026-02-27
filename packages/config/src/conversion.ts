import { parseEnv as parseDotenv } from "node:util";

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { configEnvTomlMappings, type EnvValueFormat } from "./conversion-mappings.js";
import { isObjectRecord, getValueAtPath, setValueAtPath } from "./core/record.js";
import { configModules } from "./modules.js";
import { loadFromEnv, loadFromToml } from "./pipeline.js";

function expectFiniteNumberValue(value: unknown, envVar: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`Invalid value for ${envVar}. Expected a finite number.`);
  }

  return value;
}

function expectBooleanValue(value: unknown, envVar: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid value for ${envVar}. Expected a boolean.`);
  }

  return value;
}

function expectStringArrayValue(value: unknown, envVar: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid value for ${envVar}. Expected an array of strings.`);
  }

  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`Invalid value for ${envVar}. Expected an array of strings.`);
    }
  }

  return value;
}

function formatDefaultEnvValue(value: unknown, envVar: string): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(expectFiniteNumberValue(value, envVar));
  }

  if (typeof value === "boolean") {
    return String(expectBooleanValue(value, envVar));
  }

  throw new Error(
    `Invalid value for ${envVar}. Expected a string, number, or boolean for env serialization.`,
  );
}

function formatCsvEnvValue(value: unknown, envVar: string): string {
  return expectStringArrayValue(value, envVar).join(",");
}

function formatEnvValue(
  value: unknown,
  envVar: string,
  envValueFormat: EnvValueFormat | undefined,
): string {
  if (envValueFormat === "csv") {
    return formatCsvEnvValue(value, envVar);
  }

  return formatDefaultEnvValue(value, envVar);
}

function mapConfigToTomlRoot(configRoot: Record<string, unknown>): Record<string, unknown> {
  let tomlRoot: Record<string, unknown> = {};

  for (const mapping of configEnvTomlMappings) {
    const value = getValueAtPath(configRoot, mapping.configPath);
    if (value === undefined) {
      continue;
    }

    tomlRoot = setValueAtPath(tomlRoot, mapping.tomlPath, value);
  }

  return tomlRoot;
}

function mapConfigToEnvRecord(configRoot: Record<string, unknown>): NodeJS.ProcessEnv {
  const envRecord: NodeJS.ProcessEnv = {};

  for (const mapping of configEnvTomlMappings) {
    const value = getValueAtPath(configRoot, mapping.configPath);
    if (value === undefined) {
      continue;
    }

    const formattedValue = formatEnvValue(value, mapping.envVar, mapping.envValueFormat);
    envRecord[mapping.envVar] = formattedValue;
  }

  return envRecord;
}

function quoteEnvFileValue(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  const safeUnquotedValuePattern = /^[A-Za-z0-9_./:@,+-]+$/;
  if (safeUnquotedValuePattern.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function assertTomlRoot(value: unknown): Record<string, unknown> {
  if (!isObjectRecord(value)) {
    throw new Error("Invalid TOML content. Expected a top-level TOML table.");
  }

  return value;
}

export function parseDotenvContent(content: string): NodeJS.ProcessEnv {
  return parseDotenv(content);
}

export function stringifyDotenvContent(env: NodeJS.ProcessEnv): string {
  const definedEntries: [string, string][] = [];

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }

    definedEntries.push([key, value]);
  }

  const sortedEntries = definedEntries.sort((left, right) => left[0].localeCompare(right[0]));

  return sortedEntries.map(([key, value]) => `${key}=${quoteEnvFileValue(value)}`).join("\n");
}

export function convertEnvToTomlRecord(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const loadedConfigRoot = loadFromEnv(configModules, env);
  return mapConfigToTomlRoot(loadedConfigRoot);
}

export function convertTomlToEnvRecord(tomlRoot: Record<string, unknown>): NodeJS.ProcessEnv {
  const loadedConfigRoot = loadFromToml(configModules, tomlRoot);
  return mapConfigToEnvRecord(loadedConfigRoot);
}

export function convertDotenvContentToTomlContent(content: string): string {
  const env = parseDotenvContent(content);
  const tomlRoot = convertEnvToTomlRecord(env);
  return stringifyToml(tomlRoot);
}

export function convertTomlContentToDotenvContent(content: string): string {
  const parsedToml = assertTomlRoot(parseToml(content));
  const env = convertTomlToEnvRecord(parsedToml);
  return stringifyDotenvContent(env);
}
