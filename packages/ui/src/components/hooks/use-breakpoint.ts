import * as React from "react";

const CssBreakpointVariables: {
  readonly MD: "--breakpoint-md";
  readonly SM: "--breakpoint-sm";
} = {
  MD: "--breakpoint-md",
  SM: "--breakpoint-sm",
};

type CssBreakpointVariable = (typeof CssBreakpointVariables)[keyof typeof CssBreakpointVariables];

export function useIsBelowBreakpoint(breakpoint: CssBreakpointVariable): boolean {
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => subscribeToBreakpoint(breakpoint, onStoreChange),
    [breakpoint],
  );
  const getSnapshot = React.useCallback(() => isBelowBreakpoint(breakpoint), [breakpoint]);

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribeToBreakpoint(
  breakpoint: CssBreakpointVariable,
  onStoreChange: () => void,
): () => void {
  const mediaQuery = createBreakpointMediaQuery(breakpoint);
  mediaQuery.addEventListener("change", onStoreChange);

  return () => {
    mediaQuery.removeEventListener("change", onStoreChange);
  };
}

function isBelowBreakpoint(breakpoint: CssBreakpointVariable): boolean {
  return createBreakpointMediaQuery(breakpoint).matches;
}

function createBreakpointMediaQuery(breakpoint: CssBreakpointVariable): MediaQueryList {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    throw new Error("window.matchMedia is required to read responsive breakpoints.");
  }

  const breakpointPx = readCssBreakpointPx(breakpoint);
  return window.matchMedia(`(max-width: ${String(breakpointPx - 0.02)}px)`);
}

function getServerSnapshot(): boolean {
  return false;
}

function readCssBreakpointPx(variableName: CssBreakpointVariable): number {
  const rawValue = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  if (rawValue.length === 0) {
    throw new Error(`CSS breakpoint variable '${variableName}' is not defined.`);
  }

  return parseCssLengthPx({
    rawValue,
    variableName,
  });
}

function parseCssLengthPx(input: {
  rawValue: string;
  variableName: CssBreakpointVariable;
}): number {
  if (input.rawValue.endsWith("px")) {
    return parsePositiveCssNumber({
      rawNumber: input.rawValue.slice(0, -2),
      variableName: input.variableName,
    });
  }

  if (input.rawValue.endsWith("rem")) {
    return (
      parsePositiveCssNumber({
        rawNumber: input.rawValue.slice(0, -3),
        variableName: input.variableName,
      }) * readRootFontSizePx()
    );
  }

  throw new Error(
    `CSS breakpoint variable '${input.variableName}' must use px or rem units. Received '${input.rawValue}'.`,
  );
}

function parsePositiveCssNumber(input: {
  rawNumber: string;
  variableName: CssBreakpointVariable;
}): number {
  const parsedNumber = Number(input.rawNumber);
  if (!Number.isFinite(parsedNumber) || parsedNumber <= 0) {
    throw new Error(
      `CSS breakpoint variable '${input.variableName}' must be a positive length. Received '${input.rawNumber}'.`,
    );
  }

  return parsedNumber;
}

function readRootFontSizePx(): number {
  const rawFontSize = getComputedStyle(document.documentElement).fontSize;
  if (!rawFontSize.endsWith("px")) {
    throw new Error(`Root font-size must use px units. Received '${rawFontSize}'.`);
  }

  const parsedFontSize = Number(rawFontSize.slice(0, -2));
  if (!Number.isFinite(parsedFontSize) || parsedFontSize <= 0) {
    throw new Error(`Root font-size must be a positive px value. Received '${rawFontSize}'.`);
  }

  return parsedFontSize;
}

export { CssBreakpointVariables };
export type { CssBreakpointVariable };
