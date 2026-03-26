import type { EgressCredentialRoute } from "@mistle/integrations-core";

function normalizeTargetPath(targetPath: string): string {
  if (targetPath.length === 0) {
    return "/";
  }

  return targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
}

function normalizePathPrefix(pathPrefix: string): string {
  const normalizedPathPrefix = normalizeTargetPath(pathPrefix);
  if (normalizedPathPrefix === "/") {
    return normalizedPathPrefix;
  }

  return normalizedPathPrefix.endsWith("/")
    ? normalizedPathPrefix.slice(0, -1)
    : normalizedPathPrefix;
}

function normalizeTargetHost(targetHost: string): string {
  const trimmedTargetHost = targetHost.trim().toLowerCase();
  if (trimmedTargetHost.length === 0) {
    return "";
  }

  if (trimmedTargetHost.startsWith("[")) {
    const endBracketIndex = trimmedTargetHost.indexOf("]");
    if (endBracketIndex >= 0) {
      return trimmedTargetHost.slice(1, endBracketIndex);
    }
  }

  const separatorIndex = trimmedTargetHost.lastIndexOf(":");
  if (separatorIndex > 0) {
    const host = trimmedTargetHost.slice(0, separatorIndex);
    const port = trimmedTargetHost.slice(separatorIndex + 1);
    if (port.length > 0 && Number.isInteger(Number(port))) {
      return host;
    }
  }

  return trimmedTargetHost;
}

function containsStringIgnoreCase(values: ReadonlyArray<string>, target: string): boolean {
  const normalizedTarget = target.toLowerCase();
  return values.some((value) => value.toLowerCase() === normalizedTarget);
}

function hostMatches(route: EgressCredentialRoute, targetHost: string): boolean {
  const normalizedTargetHost = normalizeTargetHost(targetHost);
  return route.match.hosts.some((host) => host.toLowerCase() === normalizedTargetHost);
}

function pathMatchesPrefixes(pathPrefixes: ReadonlyArray<string>, targetPath: string): boolean {
  return pathPrefixes.some((pathPrefix) => {
    const normalizedPathPrefix = normalizePathPrefix(pathPrefix);
    return (
      normalizedPathPrefix === "/" ||
      targetPath === normalizedPathPrefix ||
      targetPath.startsWith(`${normalizedPathPrefix}/`)
    );
  });
}

export type ResolveMatchingRouteInput = {
  routes: ReadonlyArray<EgressCredentialRoute>;
  host: string;
  method: string;
  targetPath: string;
};

export function resolveMatchingEgressRoute(
  input: ResolveMatchingRouteInput,
): EgressCredentialRoute | undefined {
  const normalizedTargetPath = normalizeTargetPath(input.targetPath);

  const matchingRoutes = input.routes.filter((route) => {
    if (!hostMatches(route, input.host)) {
      return false;
    }
    if (
      route.match.methods !== undefined &&
      route.match.methods.length > 0 &&
      !containsStringIgnoreCase(route.match.methods, input.method)
    ) {
      return false;
    }
    if (
      route.match.pathPrefixes !== undefined &&
      route.match.pathPrefixes.length > 0 &&
      !pathMatchesPrefixes(route.match.pathPrefixes, normalizedTargetPath)
    ) {
      return false;
    }

    return true;
  });

  if (matchingRoutes.length === 0) {
    return undefined;
  }

  if (matchingRoutes.length > 1) {
    throw new Error(
      `multiple egress routes matched host="${normalizeTargetHost(input.host)}" method="${input.method}" path="${normalizedTargetPath}"`,
    );
  }

  return matchingRoutes[0];
}
