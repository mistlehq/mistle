import type { TriggerListEvent, TriggerListIssue } from "./triggers-types.js";

export function createTriggerListEvent(overrides?: Partial<TriggerListEvent>): TriggerListEvent {
  return {
    label: "Push",
    ...overrides,
  };
}

export function createTriggerListIssue(overrides?: Partial<TriggerListIssue>): TriggerListIssue {
  return {
    code: "MISSING_TARGET_METADATA",
    message:
      "This trigger references an integration target definition that is no longer available. Event metadata may be incomplete.",
    ...overrides,
  };
}
