import {
  AUTOMATION_SANDBOX_PROFILES_QUERY_KEY,
  useAutomationSandboxProfileOptions,
} from "./use-automation-sandbox-profile-options.js";

export const SCHEDULED_AUTOMATION_SANDBOX_PROFILES_QUERY_KEY: readonly [
  "automations",
  "sandbox-profiles",
] = AUTOMATION_SANDBOX_PROFILES_QUERY_KEY;

export function useScheduledAutomationPrerequisites(): ReturnType<
  typeof useAutomationSandboxProfileOptions
> {
  return useAutomationSandboxProfileOptions();
}
