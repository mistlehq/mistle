import type { ResolvedIntegrationMcpServer } from "@mistle/integrations-core";

export function renderMistleManagedSandboxContext(input: {
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): string {
  return [
    "Mistle-managed sandbox context:",
    "",
    "- This runtime operates behind a managed outbound proxy.",
    "- Network tools and scripts should use the sandbox's existing proxy configuration rather than expecting direct outbound access.",
    "- Provider credentials may be injected by the platform outside the sandboxed process environment.",
    "- Do not assume missing API keys or auth-related environment variables inside the sandbox mean authentication is misconfigured.",
    "- Prefer debugging request behavior and proxy-mediated access before treating missing in-process credentials as the root cause.",
    "- Do not modify proxy-related environment variables unless explicitly instructed.",
    "- `MISTLE_SANDBOX_INSTANCE_ID`, `MISTLE_SANDBOX_PROFILE_ID`, and `MISTLE_SANDBOX_PROFILE_VERSION` identify this sandbox and the profile version it came from.",
    "- When interacting with external systems, prefer the provider CLI available in the environment over ad hoc HTTP requests or raw `curl`.",
    "- Use `cmddir search <pattern>` to discover relevant commands progressively before reaching for lower-level approaches.",
    "- Examples:",
    "  - `cmddir search '^gh$'`",
    "  - `cmddir search '^(jira|slack)$'`",
    ...(hasMistleMcpServer(input.mcpServers)
      ? [
          "- Mistle MCP tools are available for interacting with Mistle resources, including sandbox profiles and draft setup scripts.",
        ]
      : []),
  ].join("\n");
}

export function renderMistleManagedSandboxContextBlock(input: {
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): string {
  return [
    "<!-- MISTLE-MANAGED:START mistle-sandbox-context -->",
    renderMistleManagedSandboxContext(input),
    "<!-- MISTLE-MANAGED:END mistle-sandbox-context -->",
  ].join("\n");
}

function hasMistleMcpServer(mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>): boolean {
  return mcpServers.some((mcpServer) => mcpServer.source.kind === "mistle");
}
