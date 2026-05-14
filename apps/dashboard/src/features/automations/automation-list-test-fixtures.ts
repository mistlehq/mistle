import type { AutomationListEvent, AutomationListIssue } from "./automations-types.js";

export function createAutomationListEvent(
  overrides?: Partial<AutomationListEvent>,
): AutomationListEvent {
  return {
    label: "Push",
    ...overrides,
  };
}

export function createAutomationListIssue(
  overrides?: Partial<AutomationListIssue>,
): AutomationListIssue {
  return {
    code: "MISSING_TARGET_METADATA",
    message:
      "This trigger references an integration target definition that is no longer available. Event metadata may be incomplete.",
    ...overrides,
  };
}
