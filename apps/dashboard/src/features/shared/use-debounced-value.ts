import { systemScheduler } from "@mistle/time";
import { useEffect, useState } from "react";

export const DEFAULT_SEARCH_DEBOUNCE_MS = 300;

export function useDebouncedValue<T>(value: T, delayMs = DEFAULT_SEARCH_DEBOUNCE_MS): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = systemScheduler.schedule(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      systemScheduler.cancel(timeoutId);
    };
  }, [delayMs, value]);

  return debouncedValue;
}
