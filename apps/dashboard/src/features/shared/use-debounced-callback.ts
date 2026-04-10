import { systemScheduler } from "@mistle/time";
import { useCallback, useEffect, useRef } from "react";

import { DEFAULT_SEARCH_DEBOUNCE_MS } from "./use-debounced-value.js";

type DebouncedCallback<TArgs extends readonly unknown[]> = ((...args: TArgs) => void) & {
  cancel: () => void;
  flush: () => void;
};

export function useDebouncedCallback<TArgs extends readonly unknown[]>(
  callback: (...args: TArgs) => void,
  delayMs = DEFAULT_SEARCH_DEBOUNCE_MS,
): DebouncedCallback<TArgs> {
  const callbackRef = useRef(callback);
  const argsRef = useRef<TArgs | null>(null);
  const timeoutIdRef = useRef<ReturnType<typeof systemScheduler.schedule> | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const cancel = useCallback(() => {
    if (timeoutIdRef.current === null) {
      return;
    }

    systemScheduler.cancel(timeoutIdRef.current);
    timeoutIdRef.current = null;
  }, []);

  const flush = useCallback(() => {
    const nextArgs = argsRef.current;
    if (nextArgs === null) {
      return;
    }

    cancel();
    argsRef.current = null;
    callbackRef.current(...nextArgs);
  }, [cancel]);

  const debouncedCallback = useCallback(
    (...args: TArgs) => {
      argsRef.current = args;
      cancel();
      timeoutIdRef.current = systemScheduler.schedule(() => {
        timeoutIdRef.current = null;
        flush();
      }, delayMs);
    },
    [cancel, delayMs, flush],
  );

  useEffect(() => {
    return cancel;
  }, [cancel]);

  return Object.assign(debouncedCallback, {
    cancel,
    flush,
  });
}
