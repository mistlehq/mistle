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
          familyId: route.familyId,
          variantId: route.variantId,
          connectionId: route.credentialResolver.connectionId,
          secretType: route.credentialResolver.secretType,
          upstreamBaseUrl: route.upstream.baseUrl,
          authInjectionType: route.authInjection.type,
          ...(route.additionalHeaders === undefined
            ? {}
            : { additionalHeaders: route.additionalHeaders }),
          ...(route.additionalCredentialHeaders === undefined
            ? {}
            : {
                additionalCredentialHeaders: route.additionalCredentialHeaders.map((header) => ({
                  header: header.header,
                  connectionId: header.credentialResolver.connectionId,
                  secretType: header.credentialResolver.secretType,
                  ...(header.credentialResolver.slotKey === undefined
                    ? {}
                    : { slotKey: header.credentialResolver.slotKey }),
                  ...(header.credentialResolver.resolverKey === undefined
                    ? {}
                    : { resolverKey: header.credentialResolver.resolverKey }),
                })),
              }),
          ...(route.authInjection.type === "aws_sigv4"
            ? {
                authInjectionService: route.authInjection.service,
                authInjectionRegion: route.authInjection.region,
              }
            : {
                authInjectionTarget: route.authInjection.target,
                ...(route.authInjection.type !== "basic" ||
                route.authInjection.username === undefined
                  ? {}
                  : { authInjectionUsername: route.authInjection.username }),
              }),
          ...(route.credentialResolver.slotKey === undefined
            ? {}
            : { slotKey: route.credentialResolver.slotKey }),
          ...(route.credentialResolver.resolverKey === undefined
            ? {}
            : { resolverKey: route.credentialResolver.resolverKey }),
          ...(route.match.methods === undefined ? {} : { allowedMethods: route.match.methods }),
          ...(route.match.pathPrefixes === undefined
            ? {}
            : { allowedPathPrefixes: route.match.pathPrefixes }),
          ...(route.requestMiddleware === undefined
            ? {}
            : { requestMiddleware: route.requestMiddleware }),
        },
        ttlSeconds: SandboxStartupGrantTtlSeconds,
      }),
    ]),
  );

  return Object.fromEntries(entries);
}
