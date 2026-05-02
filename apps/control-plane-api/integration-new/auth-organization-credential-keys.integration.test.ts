/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("auth organization credential keys integration", () => {
  it("creates an initial organization credential key on organization creation", async ({ env }) => {
    const session = await env.auth.createSession();

    const credentialKeys = await env.controlPlaneDb.query.organizationCredentialKeys.findMany({
      columns: {
        version: true,
        masterKeyVersion: true,
        ciphertext: true,
      },
      where: (table, { eq }) => eq(table.organizationId, session.organizationId),
    });
    expect(credentialKeys).toHaveLength(1);

    const [credentialKey] = credentialKeys;
    if (credentialKey === undefined) {
      throw new Error("Expected organization credential key to be created.");
    }

    expect(credentialKey.version).toBe(1);
    expect(credentialKey.masterKeyVersion).toBe(1);
    expect(credentialKey.ciphertext).toMatch(/^v1\.[^.\s]+\.[^.\s]+\.[^.\s]+$/u);
  });
});
