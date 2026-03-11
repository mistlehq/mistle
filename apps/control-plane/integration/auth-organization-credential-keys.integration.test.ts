import { describe, expect } from "vitest";

import { it } from "./test-context.js";

describe("auth organization credential keys integration", () => {
  it("creates an initial organization credential key on organization creation", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession();

    const credentialKeys = await fixture.db.query.organizationCredentialKeys.findMany({
      columns: {
        version: true,
        masterKeyVersion: true,
        ciphertext: true,
      },
      where: (table, { eq }) => eq(table.organizationId, authenticatedSession.organizationId),
    });
    expect(credentialKeys).toHaveLength(1);

    const [credentialKey] = credentialKeys;
    if (credentialKey === undefined) {
      throw new Error("Expected organization credential key to be created.");
    }

    expect(credentialKey.version).toBe(1);
    expect(credentialKey.masterKeyVersion).toBe(
      fixture.config.integrations.activeMasterEncryptionKeyVersion,
    );
    expect(credentialKey.ciphertext).toMatch(/^v1\.[^.\s]+\.[^.\s]+\.[^.\s]+$/);
  });
});
