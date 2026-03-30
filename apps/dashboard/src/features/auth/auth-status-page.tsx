import { cn } from "@mistle/ui";
import type React from "react";

import { AuthPageShell, AuthPageWidths } from "./auth-page-shell.js";

type AuthStatusPageProps = {
  align?: "start" | "center";
  actions?: React.ReactNode;
  children?: React.ReactNode;
  description?: React.ReactNode;
  maxWidthClass?: (typeof AuthPageWidths)[keyof typeof AuthPageWidths];
  title?: string | null;
};

export function AuthStatusPage(props: AuthStatusPageProps): React.JSX.Element {
  const align = props.align ?? "start";

  return (
    <AuthPageShell
      maxWidthClass={props.maxWidthClass ?? AuthPageWidths.LG}
      title={props.title === undefined ? null : props.title}
    >
      {props.description === undefined ? null : align === "center" ? (
        <p className="text-muted-foreground text-center text-sm">{props.description}</p>
      ) : (
        <p className="text-muted-foreground text-sm">{props.description}</p>
      )}
      <div className={cn("grid w-full gap-4", align === "center" ? "text-center" : null)}>
        {props.children}
        {props.actions}
      </div>
    </AuthPageShell>
  );
}
