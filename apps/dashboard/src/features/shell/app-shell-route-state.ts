import { isSettingsPath } from "../settings/model.js";
import { isExistingSandboxSessionPath, isSessionsPath } from "./app-shell-sessions-sidebar-mode.js";

export function resolveAppShellRouteState(pathname: string): {
  inAutomations: boolean;
  inDashboardRoot: boolean;
  inIntegrations: boolean;
  inSandboxProfiles: boolean;
  inSessionDetail: boolean;
  inSessions: boolean;
  inSettings: boolean;
} {
  return {
    inAutomations: pathname === "/automations" || pathname.startsWith("/automations/"),
    inDashboardRoot: pathname === "/",
    inIntegrations: pathname === "/integrations" || pathname.startsWith("/integrations/"),
    inSandboxProfiles:
      pathname === "/sandbox-profiles" || pathname.startsWith("/sandbox-profiles/"),
    inSessionDetail: isExistingSandboxSessionPath(pathname),
    inSessions: isSessionsPath(pathname),
    inSettings: isSettingsPath(pathname),
  };
}
