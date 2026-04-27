import { describe, expect, it } from "vitest";

import type { IntegrationWebhookSource } from "./integrations-service.js";
import { resolveManifestWebhookCallbackState } from "./manifest-webhook-callback-state.js";

function createWebhookSource(input?: { callbackUrl?: string }): IntegrationWebhookSource {
  return {
    id: "iws_123",
    targetKey: "github-default",
    integrationConnectionId: "conn_123",
    displayName: "Webhook",
    endpointKey: "eps_123",
    status: "active",
    providerMetadata: {},
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z",
    ...(input?.callbackUrl === undefined ? {} : { callbackUrl: input.callbackUrl }),
  };
}

describe("resolveManifestWebhookCallbackState", () => {
  it("returns loading before webhook sources settle", () => {
    expect(
      resolveManifestWebhookCallbackState({
        error: null,
        isError: false,
        isPending: true,
        webhookSources: undefined,
      }),
    ).toEqual({ kind: "loading" });
  });

  it("returns an error message when webhook source loading fails", () => {
    expect(
      resolveManifestWebhookCallbackState({
        error: new Error("Webhook sources failed"),
        isError: true,
        isPending: false,
        webhookSources: undefined,
      }),
    ).toEqual({
      kind: "error",
      message: "Webhook sources failed",
    });
  });

  it("returns missing when no webhook callback URL is available", () => {
    expect(
      resolveManifestWebhookCallbackState({
        error: null,
        isError: false,
        isPending: false,
        webhookSources: [createWebhookSource()],
      }),
    ).toEqual({ kind: "missing" });
  });

  it("returns ready with the first webhook callback URL", () => {
    expect(
      resolveManifestWebhookCallbackState({
        error: null,
        isError: false,
        isPending: false,
        webhookSources: [
          createWebhookSource({
            callbackUrl: "https://control-plane.example.com/p/integration/webhooks/github/eps_123",
          }),
        ],
      }),
    ).toEqual({
      kind: "ready",
      value: "https://control-plane.example.com/p/integration/webhooks/github/eps_123",
    });
  });
});
