import { isSettingsPath } from "../settings/model.js";
import { isSessionsPath } from "./app-shell-sessions-sidebar-mode.js";

export function resolveAppShellRouteState(pathname: string): {
  inSessions: boolean;
  inSettings: boolean;
} {
  return {
    inSessions: isSessionsPath(pathname),
    inSettings: isSettingsPath(pathname),
  };
}
