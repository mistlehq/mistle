import type { MiddlewareHandler } from "hono";

import type { AppContextBindings, AppContextVariables } from "../types.js";

type DynamicAppContextValues = Pick<
  AppContextVariables,
  "auth" | "dataPlaneClient" | "db" | "openWorkflow"
>;

type CreateAppContextInput = Omit<AppContextVariables, "authContext" | "session"> & {
  resolveTestContext?: (input: { testEnvironmentId: string }) => Promise<DynamicAppContextValues>;
};

export function createAppContextMiddleware(
  appContext: CreateAppContextInput,
): MiddlewareHandler<AppContextBindings> {
  return async (ctx, next) => {
    const dynamicContext = await resolveDynamicContext({
      appContext,
      readHeader: (name) => ctx.req.header(name),
    });

    ctx.set("config", appContext.config);
    ctx.set("sandboxConfig", appContext.sandboxConfig);
    ctx.set("internalAuthServiceToken", appContext.internalAuthServiceToken);
    ctx.set("db", dynamicContext.db);
    ctx.set("objectStore", appContext.objectStore);
    ctx.set("integrationRegistry", appContext.integrationRegistry);
    ctx.set("dataPlaneClient", dynamicContext.dataPlaneClient);
    ctx.set("connectionTokenConfig", appContext.connectionTokenConfig);
    ctx.set("portAccessConfig", appContext.portAccessConfig);
    ctx.set("openWorkflow", dynamicContext.openWorkflow);
    ctx.set("auth", dynamicContext.auth);
    ctx.set("session", null);
    ctx.set("authContext", null);
    await next();
  };
}

async function resolveDynamicContext(input: {
  appContext: CreateAppContextInput;
  readHeader: (name: string) => string | undefined;
}): Promise<DynamicAppContextValues> {
  const testIsolation = input.appContext.config.__dangerouslyEnableTestIsolation;
  if (testIsolation === undefined) {
    return input.appContext;
  }

  const testEnvironmentId = input.readHeader(testIsolation.testEnvironmentIdHeader);
  if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
    throw new Error(
      `Expected '${testIsolation.testEnvironmentIdHeader}' header for isolated control-plane API request.`,
    );
  }

  const resolveTestContext = input.appContext.resolveTestContext;
  if (resolveTestContext === undefined) {
    throw new Error("Expected control-plane API test context resolver.");
  }

  return resolveTestContext({
    testEnvironmentId,
  });
}
