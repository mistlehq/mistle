import type { TriggerListEvent } from "./triggers-types.js";

export function buildEventSummaryTitle(events: readonly TriggerListEvent[]): string {
  return events
    .map((event) => `${event.label}${event.unavailable === true ? " (Unavailable)" : ""}`)
    .join(", ");
}

export function resolveEventSummary(input: { events: readonly TriggerListEvent[] }): {
  firstEvent: TriggerListEvent | null;
  remainingCount: number;
  title: string;
} {
  const [firstEvent, ...remainingEvents] = input.events;

  return {
    firstEvent: firstEvent ?? null,
    remainingCount: remainingEvents.length,
    title: buildEventSummaryTitle(input.events),
  };
}
