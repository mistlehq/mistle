import { CssBreakpointVariables, useIsBelowBreakpoint } from "./use-breakpoint.js";

export function useIsMobile(): boolean {
  return useIsBelowBreakpoint(CssBreakpointVariables.MD);
}
