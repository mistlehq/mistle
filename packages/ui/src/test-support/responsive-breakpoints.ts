import { CssBreakpointVariables } from "../components/hooks/use-breakpoint.js";

const ResponsiveBreakpointTestValues: Record<
  (typeof CssBreakpointVariables)[keyof typeof CssBreakpointVariables],
  string
> = {
  [CssBreakpointVariables.MD]: "48rem",
  [CssBreakpointVariables.SM]: "40rem",
};

export function installResponsiveBreakpointTestVariables(input: { document: Document }): void {
  for (const breakpoint of Object.values(CssBreakpointVariables)) {
    input.document.documentElement.style.setProperty(
      breakpoint,
      ResponsiveBreakpointTestValues[breakpoint],
    );
  }

  input.document.documentElement.style.fontSize = "16px";
}
