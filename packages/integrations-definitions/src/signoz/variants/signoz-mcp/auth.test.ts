import { describe, expect, it } from "vitest";

import {
  SignozConnectionConfigSchema,
  SignozConnectionStartConfigSchema,
  SignozRegionSchema,
} from "./auth.js";

describe("SigNoz auth config", () => {
  it("accepts only the hosted SigNoz regions supported by the connection flow", () => {
    expect(SignozRegionSchema.parse("us")).toBe("us");
    expect(SignozRegionSchema.parse("eu")).toBe("eu");
    expect(() => SignozRegionSchema.parse("us2")).toThrow("Region must be US or EU.");
  });

  it("uses the same region constraint for start and persisted connection config", () => {
    expect(SignozConnectionStartConfigSchema.parse({ region: "eu" })).toEqual({ region: "eu" });
    expect(() => SignozConnectionStartConfigSchema.parse({ region: "us2" })).toThrow(
      "Region must be US or EU.",
    );
    expect(() =>
      SignozConnectionConfigSchema.parse({
        connection_method: "oauth2-authorization-code",
        region: "us2",
        client_id: "signoz_client_123",
      }),
    ).toThrow("Region must be US or EU.");
  });
});
