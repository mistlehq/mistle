import { createHash } from "node:crypto";

export const TestEnvironmentIdHeader = "x-mistle-test-environment-id";

export function createDataPlaneTestSchemaName(testEnvironmentId: string): string {
  const normalized = testEnvironmentId.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");
  const prefix = /^[a-z]/u.test(normalized) ? normalized : `env_${normalized}`;
  const digest = createHash("sha256").update(testEnvironmentId).digest("hex").slice(0, 10);
  const schemaName = `${prefix.slice(0, 40)}_${digest}_data_plane`;
  if (schemaName.length > 63) {
    throw new Error(`Test data-plane schema name '${schemaName}' exceeds Postgres length limits.`);
  }

  return schemaName;
}
