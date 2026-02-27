import type React from "react";

import { MistleLogo } from "../../components/mistle-logo.js";

export const AuthPageWidths = {
  SM: "max-w-sm",
  LG: "max-w-lg",
  XL: "max-w-xl",
} as const;

type AuthPageWidthClass = (typeof AuthPageWidths)[keyof typeof AuthPageWidths];

type AuthPageShellProps = {
  children: React.ReactNode;
  maxWidthClass: AuthPageWidthClass;
  title: string | null;
};

export function AuthPageShell(props: AuthPageShellProps): React.JSX.Element {
  return (
    <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
      <div
        className={`mx-auto flex min-h-svh w-full ${props.maxWidthClass} items-center px-4 py-8`}
      >
        <div className="w-full gap-4 flex flex-col">
          <MistleLogo className="mx-auto" mode="with-text" />
          {props.title === null ? null : (
            <h1 className="text-center text-lg font-medium">{props.title}</h1>
          )}
          {props.children}
        </div>
      </div>
    </main>
  );
}
