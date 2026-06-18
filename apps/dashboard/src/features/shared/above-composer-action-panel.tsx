import type React from "react";

export type AboveComposerActionDetail = {
  label: string;
  value: React.ReactNode;
};

export type AboveComposerActionPanelProps = {
  actions: React.ReactNode;
  details: React.ReactNode;
  title: string;
};

export type AboveComposerActionPanelStackProps = {
  children: React.ReactNode;
};

export function AboveComposerActionPanelStack(
  input: AboveComposerActionPanelStackProps,
): React.JSX.Element {
  return <div className="mb-4 max-h-72 space-y-2 overflow-y-auto px-1 pr-2">{input.children}</div>;
}

export function AboveComposerActionPanel(input: AboveComposerActionPanelProps): React.JSX.Element {
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

export function AboveComposerActionDetailList(input: {
  details: readonly AboveComposerActionDetail[];
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
