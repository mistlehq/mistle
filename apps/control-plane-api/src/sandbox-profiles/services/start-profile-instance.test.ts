import { SandboxProfileVersionDefaultPersistenceModes } from "@mistle/db/control-plane";
import { SandboxInstancePersistenceModes } from "@mistle/db/data-plane";
import { describe, expect, it } from "vitest";

import { resolveProfileStartPersistenceMode } from "./start-profile-instance.js";

describe("resolveProfileStartPersistenceMode", () => {
  it("returns ephemeral when organization persistent sandboxes are disabled", () => {
    expect(
      resolveProfileStartPersistenceMode({
        organizationPersistentSandboxesEnabled: false,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
      }),
    ).toBe(SandboxInstancePersistenceModes.EPHEMERAL);
  });

  it("returns persistent when organization persistent sandboxes are enabled and the profile version requests persistent", () => {
    expect(
      resolveProfileStartPersistenceMode({
        organizationPersistentSandboxesEnabled: true,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
      }),
    ).toBe(SandboxInstancePersistenceModes.PERSISTENT);
  });

  it("returns ephemeral when organization persistent sandboxes are enabled and the profile version requests ephemeral", () => {
    expect(
      resolveProfileStartPersistenceMode({
        organizationPersistentSandboxesEnabled: true,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
      }),
    ).toBe(SandboxInstancePersistenceModes.EPHEMERAL);
  });
});
