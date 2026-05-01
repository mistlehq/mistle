import { createHash } from "node:crypto";

export function createControlPlaneTestSchemaName(testEnvironmentId: string): string {
  return createTestSchemaName({
    testEnvironmentId,
    suffix: "control_plane",
  });
}

export function createDataPlaneTestSchemaName(testEnvironmentId: string): string {
  return createTestSchemaName({
    testEnvironmentId,
    suffix: "data_plane",
  });
}

export function createControlPlaneWorkflowNamespaceId(testEnvironmentId: string): string {
  return `cp_${createSafeIdentifier(testEnvironmentId)}`;
}

export function createDataPlaneWorkflowNamespaceId(testEnvironmentId: string): string {
  return `dp_${createSafeIdentifier(testEnvironmentId)}`;
}

function createTestSchemaName(input: { testEnvironmentId: string; suffix: string }): string {
  const prefix = createSafePrefix(input.testEnvironmentId);
  const digest = createHash("sha256").update(input.testEnvironmentId).digest("hex").slice(0, 10);
  const schemaName = `${prefix.slice(0, 40)}_${digest}_${input.suffix}`;

  if (schemaName.length > 63) {
    throw new Error(`Test schema name '${schemaName}' exceeds Postgres length limits.`);
  }

  return schemaName;
}

function createSafeIdentifier(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 10);
  const compact = normalized.length === 0 ? "env" : normalized.slice(0, 28);
  return `${compact}_${digest}`;
}

function createSafePrefix(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");
  return /^[a-z]/u.test(normalized) ? normalized : `env_${normalized}`;
}
