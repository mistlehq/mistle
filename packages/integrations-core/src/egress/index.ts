import type { EgressCredentialRoute } from "../types/index.js";

export type EgressRequest = {
  host: string;
  path: string;
  method: string;
};

function normalizeHost(host: string): string {
  const normalized = host.trim().toLowerCase();

  if (normalized.length === 0) {
    throw new Error("Egress request host must be non-empty.");
  }

  return normalized;
}

function normalizeMethod(method: string): string {
  const normalized = method.trim().toUpperCase();

  if (normalized.length === 0) {
    throw new Error("Egress request method must be non-empty.");
  }

  return normalized;
}

function normalizePath(path: string): string {
  if (path.length === 0) {
    throw new Error("Egress request path must be non-empty.");
  }

  if (path.startsWith("/")) {
    return path;
  }

  return `/${path}`;
}

function hasHostOverlap(
  leftHosts: ReadonlyArray<string>,
  rightHosts: ReadonlyArray<string>,
): boolean {
  const rightSet = new Set(rightHosts.map((host) => host.toLowerCase()));

  for (const leftHost of leftHosts) {
    if (rightSet.has(leftHost.toLowerCase())) {
      return true;
    }
  }

  return false;
}

function hasMethodOverlap(
  leftMethods: ReadonlyArray<string> | undefined,
  rightMethods: ReadonlyArray<string> | undefined,
): boolean {
  if (leftMethods === undefined || rightMethods === undefined) {
    return true;
  }

  const rightSet = new Set(rightMethods.map((method) => method.toUpperCase()));
  for (const leftMethod of leftMethods) {
    if (rightSet.has(leftMethod.toUpperCase())) {
      return true;
    }
  }

  return false;
}

function hasPathPrefixOverlap(
  leftPathPrefixes: ReadonlyArray<string> | undefined,
  rightPathPrefixes: ReadonlyArray<string> | undefined,
): boolean {
  if (leftPathPrefixes === undefined || rightPathPrefixes === undefined) {
    return true;
  }

  for (const leftPrefix of leftPathPrefixes) {
    for (const rightPrefix of rightPathPrefixes) {
      if (leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix)) {
        return true;
      }
    }
  }

  return false;
}

function getLongestPathPrefixLength(route: EgressCredentialRoute): number {
  if (route.match.pathPrefixes === undefined || route.match.pathPrefixes.length === 0) {
    return 0;
  }

  let longestLength = 0;
  for (const pathPrefix of route.match.pathPrefixes) {
    if (pathPrefix.length > longestLength) {
      longestLength = pathPrefix.length;
    }
  }

  return longestLength;
}

export function matchesRoute(input: {
  route: EgressCredentialRoute;
  request: EgressRequest;
}): boolean {
  const normalizedHost = normalizeHost(input.request.host);
  const normalizedMethod = normalizeMethod(input.request.method);
  const normalizedPath = normalizePath(input.request.path);

  const hasMatchingHost = input.route.match.hosts.some(
    (host) => host.toLowerCase() === normalizedHost,
  );

  if (!hasMatchingHost) {
    return false;
  }

  if (input.route.match.methods !== undefined) {
    const normalizedMethods = input.route.match.methods.map((method) => method.toUpperCase());
    if (!normalizedMethods.includes(normalizedMethod)) {
      return false;
    }
  }

  if (input.route.match.pathPrefixes !== undefined) {
    const hasMatchingPathPrefix = input.route.match.pathPrefixes.some((pathPrefix) =>
      normalizedPath.startsWith(pathPrefix),
    );

    if (!hasMatchingPathPrefix) {
      return false;
    }
  }

  return true;
}

export function routesOverlap(input: {
  left: EgressCredentialRoute;
  right: EgressCredentialRoute;
}): boolean {
  return (
    hasHostOverlap(input.left.match.hosts, input.right.match.hosts) &&
    hasMethodOverlap(input.left.match.methods, input.right.match.methods) &&
    hasPathPrefixOverlap(input.left.match.pathPrefixes, input.right.match.pathPrefixes)
  );
}

export function orderRoutesForMatching(
  input: ReadonlyArray<EgressCredentialRoute>,
): ReadonlyArray<EgressCredentialRoute> {
  return [...input].sort((left, right) => {
    const leftHostSpecificity = left.match.hosts.length;
    const rightHostSpecificity = right.match.hosts.length;
    if (leftHostSpecificity !== rightHostSpecificity) {
      return leftHostSpecificity - rightHostSpecificity;
    }

    const leftHasMethods = left.match.methods !== undefined;
    const rightHasMethods = right.match.methods !== undefined;
    if (leftHasMethods !== rightHasMethods) {
      return leftHasMethods ? -1 : 1;
    }

    if (left.match.methods !== undefined && right.match.methods !== undefined) {
      if (left.match.methods.length !== right.match.methods.length) {
        return left.match.methods.length - right.match.methods.length;
      }
    }

    const leftLongestPathPrefix = getLongestPathPrefixLength(left);
    const rightLongestPathPrefix = getLongestPathPrefixLength(right);
    if (leftLongestPathPrefix !== rightLongestPathPrefix) {
      return rightLongestPathPrefix - leftLongestPathPrefix;
    }

    return left.routeId.localeCompare(right.routeId);
  });
}

export function resolveRouteForRequest(input: {
  routes: ReadonlyArray<EgressCredentialRoute>;
  request: EgressRequest;
}): EgressCredentialRoute | undefined {
  const orderedRoutes = orderRoutesForMatching(input.routes);

  for (const route of orderedRoutes) {
    if (
      matchesRoute({
        route,
        request: input.request,
      })
    ) {
      return route;
    }
  }

  return undefined;
}
