import { describe, expect, it } from "vitest";

import { validateLinearBindingWriteContext } from "./validate-binding-write-context.js";

function createValidationInput(input: {
  connectionConfig: Parameters<typeof validateLinearBindingWriteContext>[0]["connection"]["config"];
}): Parameters<typeof validateLinearBindingWriteContext>[0] {
  return {
    targetKey: "linear-default",
    bindingIdOrDraftIndex: "draft:0",
    target: {
      familyId: "linear",
      variantId: "linear-default",
      config: {},
    },
    connection: {
      id: "icn_linear",
      config: input.connectionConfig,
    },
    binding: {
      kind: "connector",
      config: {
        tools: [],
      },
    },
  };
}

describe("validateLinearBindingWriteContext", () => {
  it("accepts API key connections for Linear connector bindings", () => {
    expect(
      validateLinearBindingWriteContext(
        createValidationInput({
          connectionConfig: {
            connection_method: "api-key",
          },
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("accepts user OAuth connections for Linear connector bindings", () => {
    expect(
      validateLinearBindingWriteContext(
        createValidationInput({
          connectionConfig: {
            connection_method: "oauth2-authorization-code",
            client_id: "linear_client_123",
          },
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects setup-only OAuth app connections for Linear connector bindings", () => {
    const result = validateLinearBindingWriteContext(
      createValidationInput({
        connectionConfig: {
          connection_method: "linear-oauth-app",
          client_id: "linear_client_123",
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected validation result to fail.");
    }
    expect(result.issues).toEqual([
      {
        code: "linear.setup_only_connection_method",
        field: "connection.config.connection_method",
        safeMessage:
          "Linear OAuth app connections are setup-only for identity linking and cannot be used in Linear connector bindings.",
      },
    ]);
  });
});
