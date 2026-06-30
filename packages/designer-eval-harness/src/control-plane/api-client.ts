export type DesignerEvalApiClient = {
  baseUrl: string;
  cookie: string | null;
  getJson: (path: string) => Promise<unknown>;
  postJson: (path: string, body: unknown) => Promise<unknown>;
  putJson: (path: string, body: unknown) => Promise<unknown>;
};

export function createDesignerEvalApiClient(input: {
  baseUrl: string;
  cookie?: string;
}): DesignerEvalApiClient {
  return {
    baseUrl: input.baseUrl,
    cookie: input.cookie ?? null,
    getJson: async (path) =>
      requestJson({
        baseUrl: input.baseUrl,
        cookie: input.cookie ?? null,
        method: "GET",
        path,
      }),
    postJson: async (path, body) =>
      requestJson({
        baseUrl: input.baseUrl,
        cookie: input.cookie ?? null,
        method: "POST",
        path,
        body,
      }),
    putJson: async (path, body) =>
      requestJson({
        baseUrl: input.baseUrl,
        cookie: input.cookie ?? null,
        method: "PUT",
        path,
        body,
      }),
  };
}

async function requestJson(input: {
  baseUrl: string;
  cookie: string | null;
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
}): Promise<unknown> {
  const response = await fetch(new URL(input.path, input.baseUrl), {
    method: input.method,
    headers: {
      "content-type": "application/json",
      ...(input.cookie === null ? {} : { cookie: input.cookie }),
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });

  const responseText = await response.text();
  const payload = responseText.length === 0 ? null : parseJsonResponse(responseText);
  if (!response.ok) {
    throw new Error(
      `${input.method} ${input.path} failed with ${String(response.status)}: ${responseText}`,
    );
  }

  return payload;
}

function parseJsonResponse(responseText: string): unknown {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `Expected JSON response body. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
