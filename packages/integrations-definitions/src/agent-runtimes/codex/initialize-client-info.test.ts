import { describe, expect, it } from "vitest";

import {
  CodexConversationProviderInitializeClientInfo,
  CodexDashboardInitializeClientInfo,
  CodexInitializeClientName,
} from "./initialize-client-info.js";

describe("Codex initialize client info", () => {
  it("uses the Codex CLI originator for dashboard and worker initialization", () => {
    expect(CodexDashboardInitializeClientInfo.name).toBe(CodexInitializeClientName);
    expect(CodexConversationProviderInitializeClientInfo.name).toBe(CodexInitializeClientName);
    expect(CodexInitializeClientName).toBe("codex_cli_rs");
  });
});
