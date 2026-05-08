import { CssBreakpointVariables } from "../components/hooks/use-breakpoint.js";
import type { CssBreakpointVariable } from "../components/hooks/use-breakpoint.js";

const ResponsiveBreakpointTestValues: Record<CssBreakpointVariable, string> = {
  [CssBreakpointVariables.MD]: "48rem",
  [CssBreakpointVariables.SM]: "40rem",
};

export function installResponsiveBreakpointTestVariables(targetDocument: Document): void {
  for (const breakpoint of Object.values(CssBreakpointVariables)) {
    targetDocument.documentElement.style.setProperty(
      breakpoint,
      ResponsiveBreakpointTestValues[breakpoint],
    );
  }

  targetDocument.documentElement.style.fontSize = "16px";
}
