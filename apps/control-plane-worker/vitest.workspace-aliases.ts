import { fileURLToPath } from "node:url";

export const WorkspaceAliases = [
  {
    find: /^@mistle\/config$/,
    replacement: fileURLToPath(new URL("../../packages/config/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/control-plane-internal-client$/,
    replacement: fileURLToPath(
      new URL("../../packages/control-plane-internal-client/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/data-plane-internal-client$/,
    replacement: fileURLToPath(
      new URL("../../packages/data-plane-internal-client/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/db\/control-plane$/,
    replacement: fileURLToPath(
      new URL("../../packages/db/src/control-plane/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/db\/migrator$/,
    replacement: fileURLToPath(new URL("../../packages/db/src/migrator/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/emails$/,
    replacement: fileURLToPath(new URL("../../packages/emails/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/http$/,
    replacement: fileURLToPath(new URL("../../packages/http/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/integrations-core$/,
    replacement: fileURLToPath(
      new URL("../../packages/integrations-core/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/integrations-core\/triggers$/,
    replacement: fileURLToPath(
      new URL("../../packages/integrations-core/src/triggers/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/integrations-definitions$/,
    replacement: fileURLToPath(
      new URL("../../packages/integrations-definitions/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/integrations-definitions\/server$/,
    replacement: fileURLToPath(
      new URL("../../packages/integrations-definitions/src/server.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/integrations-definitions\/agent-runtimes\/server$/,
    replacement: fileURLToPath(
      new URL(
        "../../packages/integrations-definitions/src/agent-runtimes/server.ts",
        import.meta.url,
      ),
    ),
  },
  {
    find: /^@mistle\/logging$/,
    replacement: fileURLToPath(new URL("../../packages/logging/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/sandbox-session-client$/,
    replacement: fileURLToPath(
      new URL("../../packages/sandbox-session-client/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/sandbox-session-client\/node$/,
    replacement: fileURLToPath(
      new URL("../../packages/sandbox-session-client/src/node.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/sandbox-session-protocol$/,
    replacement: fileURLToPath(
      new URL("../../packages/sandbox-session-protocol/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/telemetry$/,
    replacement: fileURLToPath(new URL("../../packages/telemetry/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/test-harness$/,
    replacement: fileURLToPath(
      new URL("../../packages/test-harness/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/time$/,
    replacement: fileURLToPath(new URL("../../packages/time/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/workflow-registry\/control-plane$/,
    replacement: fileURLToPath(
      new URL("../../packages/workflow-registry/src/control-plane.ts", import.meta.url),
    ),
  },
];
