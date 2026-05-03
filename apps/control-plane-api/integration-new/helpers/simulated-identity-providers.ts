import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { reserveAvailablePort } from "@mistle/test-harness";

export type SimulatedProviderRequest = {
  method: string;
  pathname: string;
  search: string;
  body: string;
  authorization?: string;
};

export type SimulatedProvider = {
  baseUrl: string;
  requests: SimulatedProviderRequest[];
  stop: () => Promise<void>;
};

export async function startSimulatedGitHubIdentityProvider(
  input: {
    tokenStatusCode?: number;
    tokenResponse?: unknown;
    userResponse?: unknown;
    emailsResponse?: unknown;
  } = {},
): Promise<SimulatedProvider> {
  const tokenResponse = input.tokenResponse ?? {
    access_token: "ghu_user_token",
    expires_in: 28_800,
    refresh_token: "ghr_refresh_token",
    refresh_token_expires_in: 15_897_600,
    scope: "pull_requests:write,repo",
    token_type: "bearer",
  };
  const userResponse = input.userResponse ?? {
    id: 12_345,
    login: "mistle-user",
    name: "Mistle User",
    email: null,
    avatar_url: "https://avatars.example.com/u/12345",
  };
  const emailsResponse = input.emailsResponse ?? [
    {
      email: "mistle-user@example.com",
      primary: true,
      verified: true,
    },
  ];

  return startSimulatedProvider(async ({ requestUrl, response }) => {
    // Simulates GitHub's user-to-server token and user profile boundaries used by
    // packages/integrations-definitions/src/github/shared/identity-linking.server.ts.
    // Official docs:
    // https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
    // https://docs.github.com/en/rest/users/users
    // https://docs.github.com/en/rest/users/emails
    if (requestUrl.pathname === "/login/oauth/access_token") {
      response.statusCode = input.tokenStatusCode ?? 200;
      writeJson(response, tokenResponse);
      return;
    }

    if (requestUrl.pathname === "/user") {
      writeJson(response, userResponse);
      return;
    }

    if (requestUrl.pathname === "/user/emails") {
      writeJson(response, emailsResponse);
      return;
    }

    response.statusCode = 404;
    writeJson(response, { message: "Not found." });
  });
}

export async function startSimulatedSlackIdentityProvider(
  input: {
    tokenResponse?: unknown;
    profileResponse?: unknown;
  } = {},
): Promise<SimulatedProvider> {
  const tokenResponse = input.tokenResponse ?? {
    ok: true,
    team: {
      id: "T12345",
      name: "Mistle Engineering",
    },
    authed_user: {
      id: "U12345",
      scope: "users.profile:read,users:read,users:read.email",
      access_token: "xoxe.xoxp-slack-user-token",
      expires_in: 43_200,
      token_type: "user",
    },
  };
  const profileResponse = input.profileResponse ?? {
    ok: true,
    profile: {
      display_name: "Mistle Slack User",
      real_name: "Mistle Slack User Real",
      image_192: "https://avatars.slack-edge.com/u12345.png",
      email: "mistle-slack-user@example.com",
    },
  };

  return startSimulatedProvider(async ({ requestUrl, response }) => {
    // Simulates Slack OAuth v2 and user profile boundaries used by
    // packages/integrations-definitions/src/slack/variants/slack-default/identity-linking.server.ts.
    // Official docs:
    // https://docs.slack.dev/authentication/installing-with-oauth/
    // https://docs.slack.dev/reference/methods/users.profile.get
    if (requestUrl.pathname === "/api/oauth.v2.access") {
      writeJson(response, tokenResponse);
      return;
    }

    if (requestUrl.pathname === "/api/users.profile.get") {
      writeJson(response, profileResponse);
      return;
    }

    response.statusCode = 404;
    writeJson(response, { ok: false, error: "not_found" });
  });
}

async function startSimulatedProvider(
  handler: (input: { requestUrl: URL; response: ServerResponse }) => Promise<void>,
): Promise<SimulatedProvider> {
  const host = "127.0.0.1";
  const port = await reserveAvailablePort({ host });
  const requests: SimulatedProviderRequest[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port.toString()}`);
    const body = await readRequestBody(request);
    requests.push({
      method: request.method ?? "GET",
      pathname: requestUrl.pathname,
      search: requestUrl.search,
      body,
      ...(typeof request.headers.authorization === "string"
        ? { authorization: request.headers.authorization }
        : {}),
    });

    response.setHeader("content-type", "application/json");
    await handler({ requestUrl, response });
  });

  await listen(server, { host, port });

  return {
    baseUrl: `http://${host}:${port.toString()}`,
    requests,
    stop: async () => close(server),
  };
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8");
  let body = "";

  for await (const chunk of request) {
    if (typeof chunk !== "string") {
      throw new Error("Expected simulated provider request body to be decoded as UTF-8.");
    }

    body += chunk;
  }

  return body;
}

async function listen(server: Server, input: { host: string; port: number }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

function writeJson(response: ServerResponse, body: unknown): void {
  response.end(JSON.stringify(body));
}
