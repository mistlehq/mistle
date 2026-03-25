import { cn } from "@mistle/ui";
import type { ReactNode } from "react";

export type FormPageShellProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  maxWidthClassName?: string;
};

export function FormPageShell(input: FormPageShellProps): React.JSX.Element {
  return (
    <div className={cn("-mx-4 min-h-full bg-muted/30 px-4 py-6", input.className)}>
      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-4",
          input.maxWidthClassName ?? "max-w-2xl",
          input.contentClassName,
        )}
      >
        {input.children}
      </div>
    </div>
  );
}

export type FormPageSectionProps = {
  children: ReactNode;
  className?: string;
  header?: ReactNode;
};

export function FormPageSection(input: FormPageSectionProps): React.JSX.Element {
  return (
    <section className={cn("flex flex-col gap-2", input.className)}>
      {input.header === undefined ? null : input.header}
      <div className="divide-y rounded border bg-white">{input.children}</div>
    </section>
  );
}

export type FormPageHeaderProps = {
  actions?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
};

export function FormPageHeader(input: FormPageHeaderProps): React.JSX.Element {
  const hasDescription = input.description !== undefined && input.description !== null;
  const hasActions = input.actions !== undefined && input.actions !== null;
  const hasIcon = input.icon !== undefined && input.icon !== null;

  return (
    <div className="flex items-start justify-between gap-3">
      <div className={cn("flex min-w-0 flex-1 gap-3", hasIcon ? "items-center" : "items-start")}>
        {hasIcon ? <div className="shrink-0">{input.icon}</div> : null}
        <div className="min-w-0 flex-1">
          <div className={cn("flex flex-col", hasIcon ? "gap-0" : "gap-1")}>
            <h1 className={cn("truncate text-xl font-semibold", hasIcon ? "leading-tight" : null)}>
              {input.title}
            </h1>
            {hasDescription ? (
              <p
                className={cn(
                  "text-muted-foreground truncate text-sm",
                  hasIcon ? "leading-tight" : null,
                )}
              >
                {input.description}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      {hasActions ? <div className="shrink-0">{input.actions}</div> : null}
    </div>
  );
}

export type FormPageActionBarProps = {
  align?: "start" | "end";
  children: ReactNode;
  className?: string;
};

export function FormPageActionBar(input: FormPageActionBarProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-2",
        input.align === "start" ? "justify-start" : "justify-end",
        input.className,
      )}
    >
      {input.children}
    </div>
  );
}

export type FormPageFooterProps = {
  children: ReactNode;
  className?: string;
};

export function FormPageFooter(input: FormPageFooterProps): React.JSX.Element {
  return (
    <footer className={cn("flex", input.className)}>
      <FormPageActionBar className="w-full" align="end">
        {input.children}
      </FormPageActionBar>
    </footer>
  );
}
