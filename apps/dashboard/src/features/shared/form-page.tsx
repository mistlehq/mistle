import { cn } from "@mistle/ui";
import type { ReactNode } from "react";

export type FormPageStackProps = {
  children: ReactNode;
  className?: string;
};

export function FormPageStack(input: FormPageStackProps): React.JSX.Element {
  return <div className={cn("flex flex-col gap-6", input.className)}>{input.children}</div>;
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
      <div className="divide-y rounded border bg-card">{input.children}</div>
    </section>
  );
}

export type FormPageHeaderProps = {
  actions?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  title?: ReactNode;
  titleSlot?: ReactNode;
};

export function FormPageHeader(input: FormPageHeaderProps): React.JSX.Element {
  const hasDescription = input.description !== undefined && input.description !== null;
  const hasActions = input.actions !== undefined && input.actions !== null;
  const hasIcon = input.icon !== undefined && input.icon !== null;
  const hasTitle =
    typeof input.title === "string"
      ? input.title.trim().length > 0
      : input.title !== null && input.title !== undefined;
  const hasTitleSlot = input.titleSlot !== undefined && input.titleSlot !== null;

  return (
    <div className="flex items-start justify-between gap-3" data-slot="page-header">
      <div className={cn("flex min-w-0 flex-1 gap-3", hasIcon ? "items-center" : "items-start")}>
        {hasIcon ? <div className="shrink-0">{input.icon}</div> : null}
        <div className="min-w-0 flex-1">
          <div className={cn("flex flex-col", hasIcon ? "gap-0" : "gap-1")}>
            {hasTitleSlot ? (
              input.titleSlot
            ) : hasTitle ? (
              <h1
                className={cn("truncate text-xl font-semibold", hasIcon ? "leading-tight" : null)}
              >
                {input.title}
              </h1>
            ) : null}
            {hasDescription ? (
              <p
                className={cn(
                  "text-muted-foreground truncate text-sm",
                  hasIcon ? "leading-tight" : null,
                )}
                data-slot="page-header-description"
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
