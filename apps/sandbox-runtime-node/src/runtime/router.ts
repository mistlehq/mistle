import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

export type RouterState = {
  startupReady: boolean;
};

export type RouterInput = {
  state: RouterState;
  proxyHandler?: RequestListener;
};

function writeJsonResponse(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: string,
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(body);
}

function healthHandler(
  input: RouterInput,
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
): void {
  if (request.method !== "GET") {
    response.statusCode = 405;
    response.end();
    return;
  }

  if (!input.state.startupReady) {
    writeJsonResponse(response, 503, `{"ok":false}`);
    return;
  }

  writeJsonResponse(response, 200, `{"ok":true}`);
}

export function createRouter(input: RouterInput): RequestListener {
  return (request, response) => {
    if (request.url === "/__healthz") {
      healthHandler(input, request, response);
      return;
    }

    if (input.proxyHandler !== undefined) {
      input.proxyHandler(request, response);
      return;
    }

    response.statusCode = 404;
    response.end();
  };
}
