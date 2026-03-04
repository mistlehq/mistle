import { createShellCheckRule } from "../lib/create-shell-check-rule.ts";

export const SandboxSessionProtocolTypesDriftRule = createShellCheckRule({
  description: "Ensure generated dashboard sandbox session protocol types are current.",
  command: "pnpm",
  args: ["exec", "tsx", "./lint/check-sandbox-session-protocol-types-drift.ts"],
});
