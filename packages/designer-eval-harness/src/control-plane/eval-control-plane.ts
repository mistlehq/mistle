import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  CreateDesignerSessionBodySchema,
  PutDesignerSessionCanvasTabsBodySchema,
  SaveDesignerSelectedProviderResourcesBodySchema,
  SaveDesignerSelectedProviderResourcesResponseSchema,
} from "@mistle/control-plane-api/designer";

import type { DesignerEvalProductStateIntegrationBinding } from "../types.ts";
import type { DesignerEvalSessionState } from "./in-memory-state.ts";

const RequestBodyLimitBytes = 1_000_000;

export type StartedDesignerEvalControlPlane = {
  baseUrl: string;
  close: () => Promise<void>;
};

export async function startDesignerEvalControlPlane(input: {
  state: DesignerEvalSessionState;
  host?: string;
}): Promise<StartedDesignerEvalControlPlane> {
  const host = input.host ?? "127.0.0.1";
  const server = createServer((request, response) => {
    void handleDesignerEvalControlPlaneRequest({
      state: input.state,
      request,
      response,
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    await closeServer(server);
    throw new Error("Designer eval control plane did not bind to a TCP port.");
  }

  return {
    baseUrl: `http://${address.address}:${String(address.port)}`,
    close: async () => {
      await closeServer(server);
    },
  };
}

async function handleDesignerEvalControlPlaneRequest(input: {
  state: DesignerEvalSessionState;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  try {
    await routeDesignerEvalControlPlaneRequest(input);
  } catch {
    writeJson(input.response, 500, {
      error: "Designer eval control-plane request failed.",
    });
  }
}

async function routeDesignerEvalControlPlaneRequest(input: {
  state: DesignerEvalSessionState;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  if (input.request.url === undefined) {
    writeJson(input.response, 400, {
      error: "Request URL is required.",
    });
    return;
  }

  const requestUrl = new URL(input.request.url, "http://designer-eval-control-plane.local");
  const sessionScopedRoute = matchDesignerSessionRoute(requestUrl.pathname);

  if (input.request.method === "POST" && requestUrl.pathname === "/v1/designer/sessions") {
    const body = CreateDesignerSessionBodySchema.parse(await readJsonBody(input.request));
    input.state.designerSession.initialPrompt = body.prompt;
    input.state.designerSession.updatedAt = new Date().toISOString();
    writeJson(input.response, 200, input.state.designerSession);
    return;
  }

  if (input.request.method === "GET" && sessionScopedRoute?.suffix === "product-state") {
    if (!matchesSession(input.state, sessionScopedRoute.sessionId, input.response)) {
      return;
    }
    writeJson(input.response, 200, input.state.productState);
    return;
  }

  if (input.request.method === "PUT" && sessionScopedRoute?.suffix === "canvas-tabs") {
    if (!matchesSession(input.state, sessionScopedRoute.sessionId, input.response)) {
      return;
    }
    const body = PutDesignerSessionCanvasTabsBodySchema.parse(await readJsonBody(input.request));
    input.state.designerSession.canvasTabs = body.tabs;
    input.state.designerSession.updatedAt = new Date().toISOString();
    writeJson(input.response, 200, input.state.designerSession);
    return;
  }

  if (
    input.request.method === "POST" &&
    sessionScopedRoute?.suffix === "dashboard-actions/save-selected-provider-resources"
  ) {
    if (!matchesSession(input.state, sessionScopedRoute.sessionId, input.response)) {
      return;
    }
    const body = SaveDesignerSelectedProviderResourcesBodySchema.parse(
      await readJsonBody(input.request),
    );
    const receipt = saveSelectedProviderResourcesToMemory({
      state: input.state,
      body,
    });
    writeJson(input.response, 200, receipt);
    return;
  }

  writeJson(input.response, 404, {
    error: `Unsupported Designer eval control-plane route: ${input.request.method ?? "UNKNOWN"} ${requestUrl.pathname}`,
  });
}

function saveSelectedProviderResourcesToMemory(input: {
  state: DesignerEvalSessionState;
  body: ReturnType<typeof SaveDesignerSelectedProviderResourcesBodySchema.parse>;
}): ReturnType<typeof SaveDesignerSelectedProviderResourcesResponseSchema.parse> {
  validateProviderResourceSave(input);
  const selectedHandles = dedupeStrings(input.body.selectedHandles);
  const matchingBinding = input.state.productState.targetDraft.integrationBindings.find(
    (binding) => binding.kind === "git" && binding.connectionId === input.body.connectionId,
  );
  const createdBinding = matchingBinding === undefined;
  const bindingId = matchingBinding?.id ?? `ibd_${input.body.connectionId}_git`;
  const nextBinding: DesignerEvalProductStateIntegrationBinding = {
    id: bindingId,
    connectionId: input.body.connectionId,
    kind: "git",
    config: {
      ...readExistingBindingConfig(matchingBinding),
      repositories: selectedHandles,
    },
  };

  input.state.productState.targetDraft.integrationBindings = [
    ...input.state.productState.targetDraft.integrationBindings.filter(
      (binding) => binding.id !== bindingId,
    ),
    nextBinding,
  ];

  return SaveDesignerSelectedProviderResourcesResponseSchema.parse({
    kind: "sandbox-profile-draft-provider-resources-saved",
    profileId: input.body.targetDraft.profileId,
    version: input.body.targetDraft.version,
    connectionId: input.body.connectionId,
    resourceKind: input.body.resourceKind,
    bindingIntent: input.body.bindingIntent,
    bindingId,
    selectedHandles,
    createdBinding,
  });
}

function readExistingBindingConfig(
  binding: DesignerEvalProductStateIntegrationBinding | undefined,
): Record<string, unknown> {
  if (binding === undefined) {
    return {};
  }

  const config = binding.config;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error(`Designer eval binding '${binding.id}' config must be an object.`);
  }

  return Object.fromEntries(Object.entries(config));
}

function validateProviderResourceSave(input: {
  state: DesignerEvalSessionState;
  body: ReturnType<typeof SaveDesignerSelectedProviderResourcesBodySchema.parse>;
}): void {
  if (
    input.body.targetDraft.profileId !== input.state.seededState.targetDraft.profileId ||
    input.body.targetDraft.version !== input.state.seededState.targetDraft.version
  ) {
    throw new Error(
      `Designer eval can only mutate seeded draft ${input.state.seededState.targetDraft.profileId}@${String(input.state.seededState.targetDraft.version)}.`,
    );
  }
  if (input.body.resourceKind !== "repository" || input.body.bindingIntent !== "git-repositories") {
    throw new Error(
      "Designer eval currently supports only GitHub repository selections with git-repositories binding intent.",
    );
  }

  const connection = input.state.productState.providerConnections.find(
    (candidate) => candidate.id === input.body.connectionId,
  );
  if (connection === undefined) {
    throw new Error(
      `Designer eval can only save resources for seeded connections; '${input.body.connectionId}' was not seeded.`,
    );
  }
  if (connection.providerFamilyId !== "github") {
    throw new Error("Designer eval currently supports resource saves only for GitHub.");
  }

  const availableHandles = new Set(
    input.state.availableProviderResources
      .filter(
        (resource) =>
          resource.connectionId === input.body.connectionId &&
          resource.kind === input.body.resourceKind,
      )
      .map((resource) => resource.handle),
  );
  const unknownHandle = input.body.selectedHandles.find((handle) => !availableHandles.has(handle));
  if (unknownHandle !== undefined) {
    throw new Error(`Selected provider resource '${unknownHandle}' was not seeded for this eval.`);
  }
}

function matchDesignerSessionRoute(
  pathname: string,
): { sessionId: string; suffix: string } | undefined {
  const prefix = "/v1/designer/sessions/";
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }

  const remainder = pathname.slice(prefix.length);
  const slashIndex = remainder.indexOf("/");
  if (slashIndex < 0) {
    return undefined;
  }

  return {
    sessionId: decodeURIComponent(remainder.slice(0, slashIndex)),
    suffix: remainder.slice(slashIndex + 1),
  };
}

function matchesSession(
  state: DesignerEvalSessionState,
  sessionId: string,
  response: ServerResponse,
): boolean {
  if (state.designerSession.id === sessionId) {
    return true;
  }

  writeJson(response, 404, {
    error: `Designer eval session '${sessionId}' was not seeded for this run.`,
  });
  return false;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    if (typeof chunk !== "string" && !Buffer.isBuffer(chunk)) {
      throw new Error("Unsupported request body chunk.");
    }
    body += chunk.toString();
    if (Buffer.byteLength(body) > RequestBodyLimitBytes) {
      throw new Error("Designer eval request body exceeded 1000000 bytes.");
    }
  }

  if (body.length === 0) {
    return {};
  }

  return JSON.parse(body);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error !== undefined) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
}
