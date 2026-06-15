import type { EgressCredentialRoute } from "@mistle/integrations-core";

export type IntegrationConnectionCredentialRoute = EgressCredentialRoute & {
  credentialResolver: Extract<
    EgressCredentialRoute["credentialResolver"],
    { kind: "integration_connection" }
  >;
};

export function isIntegrationConnectionCredentialRoute(
  route: EgressCredentialRoute,
): route is IntegrationConnectionCredentialRoute {
  return route.credentialResolver.kind === "integration_connection";
}

export function routeHasHost(input: { route: EgressCredentialRoute; host: string }): boolean {
  return input.route.match.hosts.some((host) => host.toLowerCase() === input.host);
}

export function routeHasPathPrefix(input: {
  route: EgressCredentialRoute;
  pathPrefix: string;
}): boolean {
  const baseUrlPathname = new URL(input.route.upstream.baseUrl).pathname;
  return (
    baseUrlPathname.startsWith(input.pathPrefix) ||
    input.route.match.pathPrefixes?.some((pathPrefix) =>
      pathPrefix.startsWith(input.pathPrefix),
    ) === true
  );
}

export function isOpenAiApiRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "openai" &&
    routeHasHost({ route, host: "api.openai.com" }) &&
    route.authInjection.type === "bearer" &&
    isIntegrationConnectionCredentialRoute(route) &&
    route.credentialResolver.secretType === "api_key"
  );
}

export function isOpenAiChatGptSubscriptionRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "openai" &&
    routeHasHost({ route, host: "chatgpt.com" }) &&
    route.authInjection.type === "bearer" &&
    isIntegrationConnectionCredentialRoute(route) &&
    (route.credentialResolver.secretType === "oauth2_access_token" ||
      route.credentialResolver.secretType === "chatgpt_access_token")
  );
}

export function isAnthropicApiRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "anthropic" &&
    routeHasHost({ route, host: "api.anthropic.com" }) &&
    route.authInjection.type === "header" &&
    route.authInjection.target.toLowerCase() === "x-api-key" &&
    isIntegrationConnectionCredentialRoute(route) &&
    route.credentialResolver.secretType === "api_key"
  );
}

export function isDeepSeekApiRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "deepseek" &&
    routeHasHost({ route, host: "api.deepseek.com" }) &&
    route.authInjection.type === "bearer" &&
    isIntegrationConnectionCredentialRoute(route) &&
    route.credentialResolver.secretType === "api_key"
  );
}

export function isFireworksApiRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "fireworks" &&
    routeHasHost({ route, host: "api.fireworks.ai" }) &&
    routeHasPathPrefix({ route, pathPrefix: "/inference/v1" }) &&
    route.authInjection.type === "bearer" &&
    isIntegrationConnectionCredentialRoute(route) &&
    route.credentialResolver.secretType === "api_key"
  );
}

export function isInceptionApiRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "inception" &&
    routeHasHost({ route, host: "api.inceptionlabs.ai" }) &&
    routeHasPathPrefix({ route, pathPrefix: "/v1" }) &&
    route.authInjection.type === "bearer" &&
    isIntegrationConnectionCredentialRoute(route) &&
    route.credentialResolver.secretType === "api_key"
  );
}

export function isKimiApiRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "kimi" &&
    routeHasHost({ route, host: "api.moonshot.ai" }) &&
    route.authInjection.type === "bearer" &&
    isIntegrationConnectionCredentialRoute(route) &&
    route.credentialResolver.secretType === "api_key"
  );
}

export function isZaiApiRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "zai" &&
    routeHasHost({ route, host: "api.z.ai" }) &&
    routeHasPathPrefix({ route, pathPrefix: "/api/coding/paas/v4" }) &&
    route.authInjection.type === "bearer" &&
    isIntegrationConnectionCredentialRoute(route) &&
    route.credentialResolver.secretType === "api_key"
  );
}

export function isMiniMaxApiRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "minimax" &&
    routeHasHost({ route, host: "api.minimaxi.com" }) &&
    routeHasPathPrefix({ route, pathPrefix: "/v1" }) &&
    route.authInjection.type === "bearer" &&
    isIntegrationConnectionCredentialRoute(route) &&
    route.credentialResolver.secretType === "api_key"
  );
}

export function isMiniMaxOpenCodeApiRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "minimax" &&
    routeHasHost({ route, host: "api.minimaxi.com" }) &&
    routeHasPathPrefix({ route, pathPrefix: "/anthropic/v1" }) &&
    route.authInjection.type === "header" &&
    route.authInjection.target.toLowerCase() === "x-api-key" &&
    isIntegrationConnectionCredentialRoute(route) &&
    route.credentialResolver.secretType === "api_key"
  );
}

export function isOpenCodeGoRoute(route: EgressCredentialRoute): boolean {
  return (
    route.familyId === "opencode" &&
    routeHasHost({ route, host: "opencode.ai" }) &&
    routeHasPathPrefix({ route, pathPrefix: "/zen/go" }) &&
    route.authInjection.type === "bearer" &&
    isIntegrationConnectionCredentialRoute(route) &&
    route.credentialResolver.secretType === "api_key"
  );
}
