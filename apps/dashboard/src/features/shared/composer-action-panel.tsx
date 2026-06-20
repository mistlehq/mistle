import type React from "react";

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
