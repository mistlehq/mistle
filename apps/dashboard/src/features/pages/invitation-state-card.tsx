import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mistle/ui";
import type React from "react";

import { AuthPageWidths } from "../auth/auth-page-shell.js";

type InvitationStateCardProps = {
  actions?: React.ReactNode;
  children?: React.ReactNode;
  description?: string;
  maxWidthClass?: (typeof AuthPageWidths)[keyof typeof AuthPageWidths];
  title: string;
};

export function InvitationStateCard(props: InvitationStateCardProps): React.JSX.Element {
  return (
    <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
      <div
        className={`mx-auto flex min-h-svh w-full ${props.maxWidthClass ?? AuthPageWidths.LG} items-center px-4 py-8`}
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{props.title}</CardTitle>
            {props.description === undefined ? null : (
              <CardDescription>{props.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="gap-4 grid">
            {props.children}
            {props.actions}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
