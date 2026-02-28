import { describe, expect, it } from "vitest";

import { IntegrationManifestError, ManifestErrorCodes } from "../errors/index.js";
import { parseIntegrationManifest } from "./index.js";

describe("parseIntegrationManifest", () => {
  it("parses a valid v1 integration manifest", () => {
    const manifest = parseIntegrationManifest({
      schemaVersion: 1,
      integrations: [
        {
          bindingId: "bind_openai_agent",
          kind: "agent",
          connectionId: "conn_openai_org_123",
          config: {
            runtime: "codex-cli",
            defaultModel: "gpt-5.3-codex",
          },
        },
      ],
    });

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.integrations).toHaveLength(1);
  });

  it("fails fast when required fields are missing", () => {
    expect(() =>
      parseIntegrationManifest({
        schemaVersion: 1,
        integrations: [
          {
            bindingId: "bind_openai_agent",
            kind: "agent",
            config: {},
          },
        ],
      }),
    ).toThrowError(IntegrationManifestError);

    try {
      parseIntegrationManifest({
        schemaVersion: 1,
        integrations: [
          {
            bindingId: "bind_openai_agent",
            kind: "agent",
            config: {},
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationManifestError);
      if (error instanceof IntegrationManifestError) {
        expect(error.code).toBe(ManifestErrorCodes.INVALID_MANIFEST);
      }
    }
  });

  it("rejects unknown top-level properties", () => {
    expect(() =>
      parseIntegrationManifest({
        schemaVersion: 1,
        integrations: [],
        unknownField: true,
      }),
    ).toThrowError(IntegrationManifestError);
  });
});
