import { describe, expect, it } from "vitest";

import { NotionConnectionConfigSchema, resolveNotionCredentialSecretType } from "./auth.js";

describe("Notion auth", () => {
  it("parses the oauth2 connection method", () => {
    expect(
      NotionConnectionConfigSchema.parse({
        connection_method: "oauth2",
        workspace_id: "workspace_123",
        workspace_name: "Acme Workspace",
      }),
    ).toEqual({
      connection_method: "oauth2",
      workspace_id: "workspace_123",
      workspace_name: "Acme Workspace",
    });
  });

  it("resolves credential secret type for oauth2 connections", () => {
    expect(
      resolveNotionCredentialSecretType({
        connection_method: "oauth2",
      }),
    ).toBe("oauth2_access_token");
  });
});
