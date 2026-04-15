import type { ReactNode } from "react";

type SectionBlockBaseProps = {
  action?: ReactNode;
  description?: ReactNode;
  title: string;
};

type SectionBlockChildrenProps = SectionBlockBaseProps & {
  children: ReactNode;
  emptyState?: never;
};

type SectionBlockEmptyStateProps = SectionBlockBaseProps & {
  children?: never;
  emptyState: ReactNode;
};

export type SectionBlockProps = SectionBlockChildrenProps | SectionBlockEmptyStateProps;

export function SectionBlock(props: SectionBlockProps): React.JSX.Element {
  const hasDescription = props.description !== undefined;

  return (
    <section className={`flex flex-col ${hasDescription ? "gap-4" : "gap-2"}`}>
      <div className="flex flex-col">
        <div className="min-h-9 items-center gap-3 flex">
          <h2 className="text-sm font-semibold tracking-wide uppercase">{props.title}</h2>
          <div className="bg-border h-px flex-1" />
          {props.action != null ? <div className="shrink-0">{props.action}</div> : null}
        </div>
        {props.description != null ? (
          <p className="-mt-1.5 text-muted-foreground text-sm">{props.description}</p>
        ) : null}
      </div>
      {props.emptyState !== undefined ? (
        <div className="text-muted-foreground text-sm">{props.emptyState}</div>
      ) : (
        <>{props.children}</>
      )}
    </section>
  );
}
