import { describe, expect, it } from "vitest";

import { CloudflareTargetConfigSchema } from "./target-config-schema.js";
import { CloudflareTargetSecretSchema } from "./target-secret-schema.js";

describe("Cloudflare target schemas", () => {
  it("does not require target-level config or secrets", () => {
    expect(CloudflareTargetConfigSchema.parse({})).toEqual({});
    expect(CloudflareTargetSecretSchema.parse({})).toEqual({});
  });
});
