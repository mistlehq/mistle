import { useMatches } from "react-router";

export type RouteTextResolverInput = {
  params: Readonly<Record<string, string | undefined>>;
  data?: unknown;
};

export type RouteTextValue = string | ((input: RouteTextResolverInput) => string);
export type RouteHrefValue = string | ((input: RouteTextResolverInput) => string | null);

export type AppRouteHandle = {
  breadcrumb?: RouteTextValue;
  breadcrumbTo?: RouteHrefValue;
  breadcrumbClickable?: boolean;
  title?: RouteTextValue;
  description?: RouteTextValue;
  headerIcon?: (input: RouteTextResolverInput) => React.ReactNode;
  hideBreadcrumb?: boolean;
};

export type AppBreadcrumb = {
  label: string;
  to: string | null;
  isCurrent: boolean;
};

export type AppPageMeta = {
  title: string | null;
  headerIcon: React.ReactNode | null;
  supportingText: string | null;
};

type MatchLike = {
  handle: unknown;
  params: unknown;
  pathname: unknown;
  data?: unknown;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMatchLike(value: unknown): value is MatchLike {
  if (!isObjectRecord(value)) {
    return false;
  }

  return "handle" in value && "params" in value && "pathname" in value;
}

function isRouteTextValue(value: unknown): value is RouteTextValue {
  return typeof value === "string" || typeof value === "function";
}

function isRouteHrefValue(value: unknown): value is RouteHrefValue {
  return typeof value === "string" || typeof value === "function";
}

function isRouteHeaderIconValue(
  value: unknown,
): value is (input: RouteTextResolverInput) => React.ReactNode {
  return typeof value === "function";
}

function normalizeParams(params: unknown): Readonly<Record<string, string | undefined>> {
  if (!isObjectRecord(params)) {
    return {};
  }

  const normalizedParams: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      normalizedParams[key] = value;
      continue;
    }

    if (value === undefined) {
      normalizedParams[key] = undefined;
    }
  }

  return normalizedParams;
}

function parseAppRouteHandle(handle: unknown): AppRouteHandle | null {
  if (!isObjectRecord(handle)) {
    return null;
  }

  const parsedHandle: AppRouteHandle = {};
  const breadcrumb = handle["breadcrumb"];
  const breadcrumbTo = handle["breadcrumbTo"];
  const breadcrumbClickable = handle["breadcrumbClickable"];
  const title = handle["title"];
  const description = handle["description"];
  const headerIcon = handle["headerIcon"];
  const hideBreadcrumb = handle["hideBreadcrumb"];

  if (isRouteTextValue(breadcrumb)) {
    parsedHandle.breadcrumb = breadcrumb;
  }

  if (isRouteHrefValue(breadcrumbTo)) {
    parsedHandle.breadcrumbTo = breadcrumbTo;
  }

  if (typeof breadcrumbClickable === "boolean") {
    parsedHandle.breadcrumbClickable = breadcrumbClickable;
  }

  if (isRouteTextValue(title)) {
    parsedHandle.title = title;
  }

  if (isRouteTextValue(description)) {
    parsedHandle.description = description;
  }

  if (isRouteHeaderIconValue(headerIcon)) {
    parsedHandle.headerIcon = headerIcon;
  }

  if (typeof hideBreadcrumb === "boolean") {
    parsedHandle.hideBreadcrumb = hideBreadcrumb;
  }

  if (
    parsedHandle.breadcrumb === undefined &&
    parsedHandle.breadcrumbTo === undefined &&
    parsedHandle.breadcrumbClickable === undefined &&
    parsedHandle.title === undefined &&
    parsedHandle.description === undefined &&
    parsedHandle.headerIcon === undefined &&
    parsedHandle.hideBreadcrumb === undefined
  ) {
    return null;
  }

  return parsedHandle;
}

function resolveRouteText(
  value: RouteTextValue | undefined,
  input: RouteTextResolverInput,
): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  const resolved = value(input);
  if (typeof resolved === "string") {
    return resolved;
  }

  return null;
}

function resolveRouteHref(
  value: RouteHrefValue | undefined,
  input: RouteTextResolverInput,
): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  const resolved = value(input);
  return typeof resolved === "string" ? resolved : null;
}

export function useAppBreadcrumbs(): AppBreadcrumb[] {
  const matches = useMatches();
  return resolveAppBreadcrumbsFromMatches(matches);
}

export function resolveAppBreadcrumbsFromMatches(matches: unknown[]): AppBreadcrumb[] {
  const breadcrumbs: AppBreadcrumb[] = [];

  for (const match of matches) {
    if (!isMatchLike(match)) {
      continue;
    }

    if (typeof match.pathname !== "string") {
      continue;
    }

    const handle = parseAppRouteHandle(match.handle);
    if (handle === null || handle.hideBreadcrumb === true) {
      continue;
    }

    const label = resolveRouteText(handle.breadcrumb, {
      params: normalizeParams(match.params),
      data: match.data,
    });
    if (label === null || label.trim().length === 0) {
      continue;
    }

    const params = normalizeParams(match.params);
    const explicitTo = resolveRouteHref(handle.breadcrumbTo, {
      params,
      data: match.data,
    });
    const canClick = handle.breadcrumbClickable !== false;
    const to = canClick ? (explicitTo ?? match.pathname) : null;

    breadcrumbs.push({
      label,
      to,
      isCurrent: false,
    });
  }

  return breadcrumbs.map((item, index) => ({
    ...item,
    isCurrent: index === breadcrumbs.length - 1,
    to: index === breadcrumbs.length - 1 ? null : item.to,
  }));
}

export function useAppPageMeta(): AppPageMeta {
  const matches = useMatches();
  return resolveAppPageMetaFromMatches(matches);
}

export function resolveAppPageMetaFromMatches(matches: unknown[]): AppPageMeta {
  if (!Array.isArray(matches)) {
    return {
      title: null,
      headerIcon: null,
      supportingText: null,
    };
  }

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches.at(index);
    if (match === undefined || !isMatchLike(match)) {
      continue;
    }

    const handle = parseAppRouteHandle(match.handle);
    if (handle === null) {
      continue;
    }

    const params = normalizeParams(match.params);
    const title = resolveRouteText(handle.title, { params, data: match.data });
    const supportingText = resolveRouteText(handle.description, { params, data: match.data });
    const headerIcon = handle.headerIcon?.({ params, data: match.data }) ?? null;

    if (title !== null || supportingText !== null || headerIcon !== null) {
      return {
        title,
        headerIcon,
        supportingText,
      };
    }
  }

  return {
    title: null,
    headerIcon: null,
    supportingText: null,
  };
}
