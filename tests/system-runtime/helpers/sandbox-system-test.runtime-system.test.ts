import { describe, expect, it } from "vitest";

import {
  createProviderSystemTestInput,
  type CreateSandboxSystemTestInput,
} from "./sandbox-system-test.js";

describe("createProviderSystemTestInput", () => {
  it("preserves Cloudflare public access for each sandbox provider variant", () => {
    const input = {
      extraInfra: ["mailpit"],
      sandboxProviders: ["docker", "e2b"],
      publicAccess: {
        provider: "cloudflare",
        services: ["data-plane-gateway", "tokenizer-proxy"],
      },
    } satisfies CreateSandboxSystemTestInput;

    expect(createProviderSystemTestInput(input, "docker").publicAccess).toEqual(input.publicAccess);
    expect(createProviderSystemTestInput(input, "e2b").publicAccess).toEqual(input.publicAccess);
  });
});
