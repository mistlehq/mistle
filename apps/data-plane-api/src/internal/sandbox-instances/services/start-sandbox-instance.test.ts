import { SandboxInstancePersistenceModes } from "@mistle/db/data-plane";
import { describe, expect, it } from "vitest";

import { resolveSandboxInstancePersistenceMode } from "./start-sandbox-instance.js";

describe("resolveSandboxInstancePersistenceMode", () => {
  it("returns ephemeral when persistent sandboxes are disabled", () => {
    expect(
      resolveSandboxInstancePersistenceMode({
        organizationId: "org_test",
        persistentSandboxesEnabled: false,
        configuredStorageBackend: "archil",
      }),
    ).toBe(SandboxInstancePersistenceModes.EPHEMERAL);
  });

  it("returns persistent when persistent sandboxes are enabled and archil is configured", () => {
    expect(
      resolveSandboxInstancePersistenceMode({
        organizationId: "org_test",
        persistentSandboxesEnabled: true,
        configuredStorageBackend: "archil",
      }),
    ).toBe(SandboxInstancePersistenceModes.PERSISTENT);
  });

  it("throws when persistent sandboxes are enabled without a supported backend", () => {
    expect(() =>
      resolveSandboxInstancePersistenceMode({
        organizationId: "org_test",
        persistentSandboxesEnabled: true,
        configuredStorageBackend: "none",
      }),
    ).toThrow(
      "Persistent sandboxes are enabled for organization 'org_test' but no supported durable storage backend is configured for this deployment.",
    );
  });
});
