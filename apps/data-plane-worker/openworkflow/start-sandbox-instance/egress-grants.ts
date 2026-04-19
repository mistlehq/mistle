import { mintEgressGrant } from "@mistle/sandbox-egress-auth";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";

const SandboxStartupGrantTtlSeconds = 60 * 60 * 24;

function toGrantCredentialResolver(input: {
  resolver: StartSandboxInstanceWorkflowInput["runtimePlan"]["egressRoutes"][number]["credentialResolver"];
  actingUserId?: StartSandboxInstanceWorkflowInput["actingUserId"];
}):
  | {
      kind: "integration_connection";
      connectionId: string;
      secretType: string;
      slotKey?: string;
      resolverKey?: string;
    }
  | {
      kind: "linked_principal";
      providerFamily: string;
      actingUserRequired: boolean;
      resolutionMode: "required" | "preferred";
      actingUserId?: string;
      credentialKind?: string;
    } {
  if (input.resolver.kind === "integration_connection") {
    return {
      kind: "integration_connection",
      connectionId: input.resolver.connectionId,
      secretType: input.resolver.secretType,
      ...(input.resolver.slotKey === undefined ? {} : { slotKey: input.resolver.slotKey }),
      ...(input.resolver.resolverKey === undefined
        ? {}
        : { resolverKey: input.resolver.resolverKey }),
    };
  }

  return {
    kind: "linked_principal",
    providerFamily: input.resolver.providerFamily,
    actingUserRequired: input.resolver.actingUserRequired,
    resolutionMode: input.resolver.resolutionMode,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
    ...(input.resolver.credentialKind === undefined
      ? {}
      : { credentialKind: input.resolver.credentialKind }),
  };
}

export async function createEgressGrantByRuleId(input: {
  config: DataPlaneWorkerRuntimeConfig;
  organizationId: string;
  sandboxInstanceId: string;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  actingUserId?: StartSandboxInstanceWorkflowInput["actingUserId"];
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
          organizationId: input.organizationId,
          familyId: route.familyId,
          variantId: route.variantId,
          credentialResolverKind: route.credentialResolver.kind,
          ...toGrantCredentialResolver({
            resolver: route.credentialResolver,
            ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
          }),
          ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
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
                  credentialResolver: toGrantCredentialResolver({
                    resolver: header.credentialResolver,
                    ...(input.actingUserId === undefined
                      ? {}
                      : { actingUserId: input.actingUserId }),
                  }),
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
