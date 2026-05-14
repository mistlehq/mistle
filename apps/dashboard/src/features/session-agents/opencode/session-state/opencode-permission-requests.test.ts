import { describe, expect, it } from "vitest";

import {
  mapOpenCodePermissionsToServerRequests,
  resolveOpenCodePermissionResponse,
} from "./opencode-permission-requests.js";

describe("OpenCode permission request presentation", () => {
  it("maps OpenCode permission requests to actionable server requests", () => {
    expect(
      mapOpenCodePermissionsToServerRequests([
        {
          id: "perm_test",
          sessionID: "ses_test",
          permission: "bash",
          patterns: ["pnpm test"],
          metadata: {},
          always: [],
        },
      ]),
    ).toEqual([
      {
        requestId: "perm_test",
        method: "opencode/permission/requestApproval",
        kind: "opencode-permission",
        sessionId: "ses_test",
        permission: "bash",
        patterns: ["pnpm test"],
        availableDecisions: ["once", "always", "reject"],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("uses the permission name when OpenCode omits shell patterns", () => {
    expect(
      mapOpenCodePermissionsToServerRequests([
        {
          id: "perm_test",
          sessionID: "ses_test",
          permission: "bash",
          patterns: [],
          metadata: {},
          always: [],
        },
      ]),
    ).toEqual([
      {
        requestId: "perm_test",
        method: "opencode/permission/requestApproval",
        kind: "opencode-permission",
        sessionId: "ses_test",
        permission: "bash",
        patterns: ["bash"],
        availableDecisions: ["once", "always", "reject"],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("resolves supported OpenCode permission decisions", () => {
    expect(resolveOpenCodePermissionResponse({ decision: "always" })).toBe("always");
    expect(resolveOpenCodePermissionResponse({ decision: "once" })).toBe("once");
    expect(resolveOpenCodePermissionResponse({ decision: "reject" })).toBe("reject");
  });

  it("rejects invalid OpenCode permission response payloads", () => {
    expect(() => resolveOpenCodePermissionResponse({ decision: "decline" })).toThrow(
      "OpenCode permission response has an unsupported decision.",
    );
    expect(() => resolveOpenCodePermissionResponse({})).toThrow(
      "OpenCode permission response is missing a decision.",
    );
  });
});
