import type { IntegrationWebhookImmediateResponse } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { createImmediateWebhookResponse } from "./create-immediate-webhook-response.js";

describe("integration webhooks app", () => {
  it("serializes JSON response bodies with a default application/json content type", async () => {
    const response = createImmediateWebhookResponse({
      status: 200,
      body: {
        challenge: "abc123",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({
      challenge: "abc123",
    });
  });

  it("preserves explicit content type and headers for string response bodies", async () => {
    const immediateResponse: IntegrationWebhookImmediateResponse = {
      status: 200,
      headers: {
        "x-provider": "slack",
      },
      contentType: "text/plain",
      body: "challenge-value",
    };

    const response = createImmediateWebhookResponse(immediateResponse);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("x-provider")).toBe("slack");
    await expect(response.text()).resolves.toBe("challenge-value");
  });

  it("supports bodyless responses and treats content-type headers case-insensitively", async () => {
    const response = createImmediateWebhookResponse({
      status: 204,
      headers: {
        "Content-Type": "application/custom+json",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("content-type")).toBe("application/custom+json");
    await expect(response.text()).resolves.toBe("");
  });
});
