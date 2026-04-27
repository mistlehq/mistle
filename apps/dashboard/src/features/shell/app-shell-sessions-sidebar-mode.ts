export const SessionsRoutes: Readonly<{
  INDEX: string;
  NEW: string;
}> = {
  INDEX: "/sessions",
  NEW: "/sessions/new",
};

export function isSessionsPath(pathname: string): boolean {
  return pathname === SessionsRoutes.INDEX || pathname.startsWith(`${SessionsRoutes.INDEX}/`);
}

export function isNewSessionPath(pathname: string): boolean {
  return pathname === SessionsRoutes.NEW;
}

export function isExistingSandboxSessionPath(pathname: string): boolean {
  return pathname.startsWith(`${SessionsRoutes.INDEX}/`) && !isNewSessionPath(pathname);
}

export function resolveSessionsSidebarModeEnabled(input: {
  pathname: string;
  enabled: boolean;
}): boolean {
  return input.enabled && isSessionsPath(input.pathname);
}

export function resolveSessionsNavHref(showSessionsSidebar: boolean): string {
  return showSessionsSidebar ? SessionsRoutes.NEW : SessionsRoutes.INDEX;
}

export function resolveLocationHref(input: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  return `${input.pathname}${input.search}${input.hash}`;
}

export function resolveSidebarModeEnableNavigationTarget(input: {
  lastInteractedSessionHref: string | null;
  pathname: string;
}): string | null {
  if (isExistingSandboxSessionPath(input.pathname)) {
    return null;
  }

  if (!isSessionsPath(input.pathname) && input.lastInteractedSessionHref !== null) {
    return input.lastInteractedSessionHref;
  }

  return SessionsRoutes.NEW;
}

export function resolveSidebarModeDisableNavigationTarget(input: {
  currentLocationHref: string;
  currentPathname: string;
  previousLocationHref: string | null;
}): string | null {
  if (input.previousLocationHref === null) {
    return null;
  }

  if (!isSessionsPath(input.currentPathname)) {
    return null;
  }

  return input.currentLocationHref === input.previousLocationHref
    ? null
    : input.previousLocationHref;
}
