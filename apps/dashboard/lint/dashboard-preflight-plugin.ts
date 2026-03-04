import { ControlPlaneClientDriftRule } from "./rules/control-plane-client-drift-rule.ts";
import { KebabCaseFileNamesRule } from "./rules/kebab-case-file-names-rule.ts";
import { SandboxSessionProtocolTypesDriftRule } from "./rules/sandbox-session-protocol-types-drift-rule.ts";
import type { PluginModule } from "./types/plugin-types.ts";

const plugin: PluginModule = {
  meta: {
    name: "dashboard-preflight",
  },
  rules: {
    "kebab-case-file-names": KebabCaseFileNamesRule,
    "control-plane-client-drift": ControlPlaneClientDriftRule,
    "sandbox-session-protocol-types-drift": SandboxSessionProtocolTypesDriftRule,
  },
};

export default plugin;
