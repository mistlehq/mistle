import type {
  OpenCodePermissionRequest,
  OpenCodePermissionResponseInput,
} from "@mistle/integrations-definitions/agent-runtimes/opencode/client";

import type { OpenCodePermissionApprovalRequestEntry } from "../../server-requests/index.js";

function normalizeOpenCodePermissionPatterns(
  permission: OpenCodePermissionRequest,
): readonly string[] {
  return permission.patterns.length === 0 ? [permission.permission] : permission.patterns;
}

export function mapOpenCodePermissionsToServerRequests(
  pendingPermissions: readonly OpenCodePermissionRequest[],
): readonly OpenCodePermissionApprovalRequestEntry[] {
  return pendingPermissions.map((permission) => ({
    requestId: permission.id,
    method: "opencode/permission/requestApproval",
    kind: "opencode-permission",
    sessionId: permission.sessionID,
    permission: permission.permission,
    patterns: normalizeOpenCodePermissionPatterns(permission),
    availableDecisions: ["once", "always", "reject"],
    status: "pending",
    responseErrorMessage: null,
  }));
}

export function resolveOpenCodePermissionResponse(
  result: unknown,
): OpenCodePermissionResponseInput["response"] {
  if (typeof result !== "object" || result === null || !("decision" in result)) {
    throw new Error("OpenCode permission response is missing a decision.");
  }

  const decision = result.decision;
  if (decision === "always" || decision === "once" || decision === "reject") {
    return decision;
  }

  throw new Error("OpenCode permission response has an unsupported decision.");
}
