export function isExistingSandboxSessionPath(pathname: string): boolean {
  return pathname.startsWith("/sessions/") && pathname !== "/sessions/new";
}

export function shouldNavigateToNewSessionOnSidebarModeEnable(pathname: string): boolean {
  return !isExistingSandboxSessionPath(pathname);
}
