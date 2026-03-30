import { mintEgressGrant } from "@mistle/sandbox-egress-auth";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";

const SandboxStartupGrantTtlSeconds = 60 * 60 * 24;

export async function createEgressGrantByRuleId(input: {
  config: DataPlaneWorkerRuntimeConfig;
  sandboxInstanceId: string;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
}): Promise<Record<string, string>> {
  const entries = await Promise.all(
    input.runtimePlan.egressRoutes.map(async (route) => [
      route.egressRuleId,
      await mintEgressGrant({
        config: {
          tokenSecret: input.config.sandbox.egress.tokenSecret,
          tokenIssuer: input.config.sandbox.egress.tokenIssuer,
          tokenAudience: input.config.sandbox.egress.tokenAudience,
        },
        claims: {
          sub: input.sandboxInstanceId,
          jti: route.egressRuleId,
          bindingId: route.bindingId,
          connectionId: route.credentialResolver.connectionId,
          secretType: route.credentialResolver.secretType,
          upstreamBaseUrl: route.upstream.baseUrl,
          authInjectionType: route.authInjection.type,
          authInjectionTarget: route.authInjection.target,
          ...(route.authInjection.username === undefined
            ? {}
            : { authInjectionUsername: route.authInjection.username }),
          ...(route.credentialResolver.purpose === undefined
            ? {}
            : { purpose: route.credentialResolver.purpose }),
          ...(route.credentialResolver.resolverKey === undefined
            ? {}
            : { resolverKey: route.credentialResolver.resolverKey }),
          ...(route.match.methods === undefined ? {} : { allowedMethods: route.match.methods }),
          ...(route.match.pathPrefixes === undefined
            ? {}
            : { allowedPathPrefixes: route.match.pathPrefixes }),
        },
        ttlSeconds: SandboxStartupGrantTtlSeconds,
      }),
    ]),
  );

  return Object.fromEntries(entries);
}
