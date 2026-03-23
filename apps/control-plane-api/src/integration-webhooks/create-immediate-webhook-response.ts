import type { IntegrationWebhookImmediateResponse } from "@mistle/integrations-core";

export function createImmediateWebhookResponse(response: IntegrationWebhookImmediateResponse) {
  const headers = new Headers(response.headers);
  const contentType = headers.get("content-type") ?? response.contentType;

  let body: BodyInit | null = null;
  if (response.body !== undefined) {
    if (typeof response.body === "string") {
      body = response.body;
    } else {
      body = JSON.stringify(response.body);
      if (contentType === undefined) {
        headers.set("content-type", "application/json");
      }
    }
  }

  if (response.contentType !== undefined && headers.get("content-type") === null) {
    headers.set("content-type", response.contentType);
  }

  return new Response(body, {
    status: response.status,
    headers,
  });
}
