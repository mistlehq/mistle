import { describe, expect, it } from "vitest";

import {
  CodexRuntimeSandboxProviders,
  createProviderSystemTestInput,
  type CreateSandboxSystemTestInput,
} from "./sandbox-system-test.js";

describe("createProviderSystemTestInput", () => {
  it("preserves Cloudflare public access for each sandbox provider variant", () => {
    const input = {
      extraInfra: ["mailpit"],
      sandboxProviders: CodexRuntimeSandboxProviders,
      publicAccess: {
        provider: "cloudflare",
        services: ["data-plane-gateway"],
      },
    } satisfies CreateSandboxSystemTestInput;

    expect(createProviderSystemTestInput(input, "docker").publicAccess).toEqual(input.publicAccess);
    expect(createProviderSystemTestInput(input, "e2b").publicAccess).toEqual(input.publicAccess);
    expect(createProviderSystemTestInput(input, "tensorlake").publicAccess).toEqual(
      input.publicAccess,
    );
  });
});
