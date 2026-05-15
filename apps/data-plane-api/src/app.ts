import { OpenAPIHono } from "@hono/zod-openapi";
import { readRepositoryVersion } from "@mistle/config";
import { Scalar } from "@scalar/hono-api-reference";

import { createInternalSandboxRoutes } from "./internal/index.js";
import type { AppRuntimeResources } from "./resources.js";
import type {
  AppContextBindings,
  DataPlaneApiConfig,
  DataPlaneApiGlobalConfig,
  DataPlaneApiSandboxStorageBackend,
  DataPlaneApp,
} from "./types.js";

const DataPlaneOpenApiPath = "/openapi.json";
const DataPlaneApiReferencePath = "/openapi";
const DataPlaneReleaseVersion = readRepositoryVersion(import.meta.url);

const DataPlaneInternalOpenApiInfo = {
  title: "Mistle Data Plane Internal API",
  version: DataPlaneReleaseVersion,
};

export type CreateAppInput = {
  config: DataPlaneApiConfig;
  environment: DataPlaneApiGlobalConfig["env"];
  internalAuthServiceToken: string;
  resources: AppRuntimeResources;
  sandboxStorageBackend: DataPlaneApiSandboxStorageBackend;
};

export function createApp(input: CreateAppInput): DataPlaneApp {
  const app = new OpenAPIHono<AppContextBindings>();

  configureApp({
    app,
    config: input.config,
    environment: input.environment,
    internalAuthServiceToken: input.internalAuthServiceToken,
    resources: input.resources,
    sandboxStorageBackend: input.sandboxStorageBackend,
  });

  return app;
}

export function configureApp(input: CreateAppInput & { app: DataPlaneApp }): void {
  const { app, config, environment, internalAuthServiceToken, resources, sandboxStorageBackend } =
    input;

  app.get("/__healthz", (ctx) => {
    return ctx.json({ ok: true });
  });

  app.use("*", async (ctx, next) => {
    const testEnvironmentId = readTestEnvironmentId({
      config,
      readHeader: (name) => ctx.req.header(name),
    });
    const requestContext = await createRequestContext({
      config,
      resources,
      testEnvironmentId,
    });

    ctx.set("config", requestContext.config);
    ctx.set("environment", environment);
    ctx.set("internalAuthServiceToken", internalAuthServiceToken);
    ctx.set("resources", requestContext.resources);
    ctx.set("controlPlaneInternalClient", requestContext.resources.controlPlaneInternalClient);
    ctx.set("sandboxStorageBackend", sandboxStorageBackend);
    await next();
  });

  app.doc(DataPlaneOpenApiPath, {
    openapi: "3.1.0",
    info: DataPlaneInternalOpenApiInfo,
  });
  if (environment === "development") {
    app.get(
      DataPlaneApiReferencePath,
      Scalar({
        pageTitle: "Mistle Data Plane Internal API Reference",
        url: DataPlaneOpenApiPath,
      }),
    );
  }

  registerApiRouteModules(app);
}

export function registerApiRouteModules(app: DataPlaneApp): void {
  registerInternalApiRouteModules(app);
}

export function registerInternalApiRouteModules(app: DataPlaneApp): void {
  const internalSandboxRoutes = createInternalSandboxRoutes();

  app.route(internalSandboxRoutes.basePath, internalSandboxRoutes.routes);
}

async function createRequestContext(input: {
  config: DataPlaneApiConfig;
  resources: AppRuntimeResources;
  testEnvironmentId: string | undefined;
}): Promise<{
  config: DataPlaneApiConfig;
  resources: AppRuntimeResources;
}> {
  if (input.testEnvironmentId === undefined) {
    return {
      config: input.config,
      resources: input.resources,
    };
  }

  const workflowNamespaceId = input.resources.getWorkflowNamespaceId({
    testEnvironmentId: input.testEnvironmentId,
  });

  return {
    config: {
      ...input.config,
      workflow: {
        ...input.config.workflow,
        namespaceId: workflowNamespaceId,
      },
    },
    resources: {
      ...input.resources,
      db: input.resources.getDb({
        testEnvironmentId: input.testEnvironmentId,
      }),
      tables: input.resources.getTables({
        testEnvironmentId: input.testEnvironmentId,
      }),
      openWorkflow: await input.resources.getOpenWorkflow({
        testEnvironmentId: input.testEnvironmentId,
      }),
      runtimeStateReader: input.resources.getRuntimeStateReader({
        testEnvironmentId: input.testEnvironmentId,
      }),
      controlPlaneInternalClient: input.resources.getControlPlaneInternalClient({
        testEnvironmentId: input.testEnvironmentId,
      }),
    },
  };
}

function readTestEnvironmentId(input: {
  config: DataPlaneApiConfig;
  readHeader: (name: string) => string | undefined;
}): string | undefined {
  const testIsolation = input.config.__dangerouslyEnableTestIsolation;
  if (testIsolation === undefined) {
    return undefined;
  }

  const testEnvironmentId = input.readHeader(testIsolation.testEnvironmentIdHeader);
  if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
    throw new Error(
      `Expected '${testIsolation.testEnvironmentIdHeader}' header for isolated data-plane API request.`,
    );
  }

  return testEnvironmentId;
}
