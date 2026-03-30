import { createHash, randomUUID } from "node:crypto";

export const IntegrationRunIdEnvVar = "MISTLE_INTEGRATION_RUN_ID";

const DatabaseIdentifierPattern = /^[a-z0-9_]+$/u;
const DefaultIntegrationRunIdLength = 12;
const DefaultScopeIdLength = 8;
const DefaultCompactedIdentifierHashLength = 8;
const MaxPostgresIdentifierLength = 63;
const MinFileHashLength = 4;

function assertSafeDatabaseIdentifier(identifier: string, label: string): string {
  if (!DatabaseIdentifierPattern.test(identifier)) {
    throw new Error(`${label} must contain only lowercase alphanumeric and underscore characters.`);
  }

  return identifier;
}

function trimIdentifierBoundaryUnderscores(identifier: string): string {
  let startIndex = 0;
  let endIndex = identifier.length;

  while (startIndex < endIndex && identifier[startIndex] === "_") {
    startIndex += 1;
  }

  while (endIndex > startIndex && identifier[endIndex - 1] === "_") {
    endIndex -= 1;
  }

  return identifier.slice(startIndex, endIndex);
}

function normalizeDatabasePrefix(prefix: string): string {
  const trimmedPrefix = trimIdentifierBoundaryUnderscores(prefix);
  if (trimmedPrefix.length === 0) {
    throw new Error("Database name prefix must not be empty.");
  }

  return assertSafeDatabaseIdentifier(trimmedPrefix, "database name prefix");
}

function normalizeIntegrationRunId(runId: string): string {
  const normalizedRunId = runId.replace(/[^a-zA-Z0-9]/gu, "").toLowerCase();
  if (normalizedRunId.length === 0) {
    throw new Error(`${IntegrationRunIdEnvVar} must contain at least one alphanumeric character.`);
  }

  return normalizedRunId.slice(0, DefaultIntegrationRunIdLength);
}

function assertPostgresIdentifierLength(identifier: string, label: string): string {
  if (identifier.length > MaxPostgresIdentifierLength) {
    throw new Error(
      `${label} '${identifier}' exceeds PostgreSQL's ${String(MaxPostgresIdentifierLength)} character identifier limit.`,
    );
  }

  return identifier;
}

function createStableHash(value: string, length: number): string {
  if (value.length === 0) {
    throw new Error("Hash input must not be empty.");
  }

  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function compactDatabaseIdentifier(identifier: string, maxLength: number): string {
  if (identifier.length <= maxLength) {
    return identifier;
  }

  if (maxLength < MinFileHashLength) {
    throw new Error(
      `Compacted database identifier length ${String(maxLength)} is too short to retain a stable hash.`,
    );
  }

  if (maxLength <= DefaultCompactedIdentifierHashLength) {
    return createStableHash(identifier, maxLength);
  }

  const hashLength = Math.min(DefaultCompactedIdentifierHashLength, maxLength - 1);
  const prefixHeadLength = maxLength - hashLength - 1;
  const prefixHead = trimIdentifierBoundaryUnderscores(identifier.slice(0, prefixHeadLength));
  const hashSuffix = createStableHash(identifier, hashLength);

  if (prefixHead.length === 0) {
    return hashSuffix;
  }

  return `${prefixHead}_${hashSuffix}`;
}

function normalizeRuntimeScopeId(scopeId: string): string {
  const normalizedScopeId = scopeId.replace(/[^a-zA-Z0-9]/gu, "").toLowerCase();
  if (normalizedScopeId.length === 0) {
    throw new Error("Runtime database scope id must contain at least one alphanumeric character.");
  }

  return normalizedScopeId.slice(0, DefaultScopeIdLength);
}

export function createIntegrationRunId(): string {
  return randomUUID().replace(/-/gu, "").slice(0, DefaultIntegrationRunIdLength);
}

export function createIntegrationRuntimeScopeId(): string {
  return randomUUID().replace(/-/gu, "").slice(0, DefaultScopeIdLength);
}

export function resolveIntegrationRunId(environment: NodeJS.ProcessEnv = process.env): string {
  const rawIntegrationRunId = environment[IntegrationRunIdEnvVar];
  if (rawIntegrationRunId === undefined || rawIntegrationRunId.length === 0) {
    return createIntegrationRunId();
  }

  return normalizeIntegrationRunId(rawIntegrationRunId);
}

export function createIntegrationTemplateDatabaseName(input: {
  prefix: string;
  runId: string;
}): string {
  const identifier = `${normalizeDatabasePrefix(input.prefix)}_${normalizeIntegrationRunId(input.runId)}`;

  return assertPostgresIdentifierLength(identifier, "template database name");
}

export function createIntegrationRuntimeDatabaseName(input: {
  prefix: string;
  runId: string;
  filePath: string;
  scopeId: string;
}): string {
  if (input.filePath.length === 0) {
    throw new Error("Test file path must not be empty.");
  }

  const normalizedRunId = normalizeIntegrationRunId(input.runId);
  const normalizedScopeId = normalizeRuntimeScopeId(input.scopeId);
  const maxPrefixLength =
    MaxPostgresIdentifierLength -
    normalizedRunId.length -
    normalizedScopeId.length -
    MinFileHashLength -
    3;

  if (maxPrefixLength < MinFileHashLength) {
    throw new Error("Runtime database name does not have enough space for the required suffixes.");
  }

  const normalizedPrefix = compactDatabaseIdentifier(
    normalizeDatabasePrefix(input.prefix),
    maxPrefixLength,
  );
  const staticPrefix = `${normalizedPrefix}_${normalizedRunId}_`;
  const availableFileHashLength =
    MaxPostgresIdentifierLength - staticPrefix.length - normalizedScopeId.length - 1;

  const identifier = `${staticPrefix}${createStableHash(input.filePath, availableFileHashLength)}_${normalizedScopeId}`;

  return assertPostgresIdentifierLength(identifier, "runtime database name");
}
