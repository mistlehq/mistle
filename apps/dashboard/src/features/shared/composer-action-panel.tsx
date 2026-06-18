import type React from "react";

export type ComposerActionDetail = {
  label: string;
  value: React.ReactNode;
};

export type ComposerActionPanelProps = {
  actions: React.ReactNode;
  details: React.ReactNode;
  title: string;
};

export type ComposerActionPanelStackProps = {
  children: React.ReactNode;
};

export function ComposerActionPanelStack(input: ComposerActionPanelStackProps): React.JSX.Element {
  return <div className="mb-4 max-h-72 space-y-2 overflow-y-auto px-1 pr-2">{input.children}</div>;
}

export function ComposerActionPanel(input: ComposerActionPanelProps): React.JSX.Element {
  return (
    <article className="rounded-xl border bg-background p-4 shadow-sm">
      <div className="space-y-3">
        <p className="font-medium text-base">{input.title}</p>
        <div>{input.details}</div>
        <div className="flex flex-wrap gap-2">{input.actions}</div>
      </div>
    </article>
  );
}

export function ComposerActionDetailList(input: {
  details: readonly ComposerActionDetail[];
}): React.JSX.Element | null {
  if (input.details.length === 0) {
    return null;
  }

  return (
    <dl className="grid gap-3 text-sm">
      {input.details.map((detail, detailIndex) => (
        <div key={`${detail.label}:${String(detailIndex)}`}>
          <dt className="text-muted-foreground">{detail.label}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap">{detail.value}</dd>
        </div>
      ))}
    </dl>
  );
}
