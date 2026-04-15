import { describe, expect, it } from "vitest";

import {
  CodexConversationProviderInitializeClientInfo,
  CodexDashboardInitializeClientInfo,
  CodexInitializeClientName,
  MistleAgentClientTitle,
} from "./initialize-client-info.js";

describe("Codex initialize client info", () => {
  it("uses the Codex CLI originator for dashboard and worker initialization", () => {
    expect(CodexDashboardInitializeClientInfo.name).toBe(CodexInitializeClientName);
    expect(CodexConversationProviderInitializeClientInfo.name).toBe(CodexInitializeClientName);
    expect(CodexInitializeClientName).toBe("codex_cli_rs");
  });

  it("uses the shared Mistle agent client title for retained clients", () => {
    expect(CodexDashboardInitializeClientInfo.title).toBe(MistleAgentClientTitle);
    expect(CodexConversationProviderInitializeClientInfo.title).toBe(MistleAgentClientTitle);
    expect(MistleAgentClientTitle).toBe("Mistle Agent Client");
  });
});
