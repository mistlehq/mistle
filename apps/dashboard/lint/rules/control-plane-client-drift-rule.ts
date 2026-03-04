import { createShellCheckRule } from "../lib/create-shell-check-rule.ts";

export const ControlPlaneClientDriftRule = createShellCheckRule({
  description: "Ensure generated dashboard control-plane OpenAPI client schema is current.",
  command: "pnpm",
  args: ["exec", "tsx", "./lint/check-control-plane-client-drift.ts"],
});
