const ManagedSandboxContext = [
  "Mistle-managed sandbox context:",
  "",
  "- This runtime operates behind a managed outbound proxy.",
  "- Network tools and scripts should use the sandbox's existing proxy configuration rather than expecting direct outbound access.",
  "- Provider credentials may be injected by the platform outside the sandboxed process environment.",
  "- Do not assume missing API keys or auth-related environment variables inside the sandbox mean authentication is misconfigured.",
  "- Prefer debugging request behavior and proxy-mediated access before treating missing in-process credentials as the root cause.",
  "- Do not modify proxy-related environment variables unless explicitly instructed.",
  "- When interacting with external systems, prefer the provider CLI available in the environment over ad hoc HTTP requests or raw `curl`.",
  "- Use `cmddir search <pattern>` to discover relevant commands progressively before reaching for lower-level approaches.",
  "- Examples:",
  "  - `cmddir search '^gh$'`",
  "  - `cmddir search '^(jira|slack)$'`",
].join("\n");

function normalizeOptionalInstructions(input: string | null): string | null {
  if (input === null) {
    return null;
  }

  return input.trim().length === 0 ? null : input;
}

export function composeCodexDeveloperInstructions(input: {
  bindingAdditionalInstructions: string | null;
  automationInstructions: string | null;
}): string {
  const sections = [ManagedSandboxContext];
  const bindingAdditionalInstructions = normalizeOptionalInstructions(
    input.bindingAdditionalInstructions,
  );
  const automationInstructions = normalizeOptionalInstructions(input.automationInstructions);

  if (bindingAdditionalInstructions !== null) {
    sections.push("", "User-provided additional instructions:", "", bindingAdditionalInstructions);
  }

  if (automationInstructions !== null) {
    sections.push("", "Automation-specific instructions:", "", automationInstructions);
  }

  return sections.join("\n");
}
