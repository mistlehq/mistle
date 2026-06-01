import type { GatewayLifecycle } from "./gateway-lifecycle.js";

export const GatewayDrainingRejectionCode = "gateway_draining";
export const GatewayDrainingRejectionMessage =
  "Gateway instance is draining; reconnect through the configured gateway URL.";

export function createGatewayDrainingJsonResponse(): Response {
  return Response.json(
    {
      error: GatewayDrainingRejectionCode,
      message: GatewayDrainingRejectionMessage,
    },
    { status: 503 },
  );
}

export function createGatewayDrainingTextResponse(): Response {
  return new Response(`${GatewayDrainingRejectionCode}: ${GatewayDrainingRejectionMessage}`, {
    status: 503,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export function createGatewayDrainingAdmissionResponse(input: {
  lifecycle: GatewayLifecycle;
  responseKind: "json" | "text";
}): Response | undefined {
  if (input.lifecycle.isServing()) {
    return undefined;
  }

  return input.responseKind === "json"
    ? createGatewayDrainingJsonResponse()
    : createGatewayDrainingTextResponse();
}
