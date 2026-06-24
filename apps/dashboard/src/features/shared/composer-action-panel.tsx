import type React from "react";

export type ComposerActionPanelProps = {
  actions: React.ReactNode;
  details: React.ReactNode;
  padding?: "flush-x";
  title: React.ReactNode | null;
};

export type ComposerActionPanelStackProps = {
  children: React.ReactNode;
};

export function ComposerActionPanelStack(input: ComposerActionPanelStackProps): React.JSX.Element {
  return <div className="mb-4 max-h-72 space-y-2 overflow-y-auto">{input.children}</div>;
}

export function ComposerActionPanel(input: ComposerActionPanelProps): React.JSX.Element {
  return (
    <article
      className={[
        "rounded-md border bg-background pt-4 pb-2",
        input.padding === "flush-x" ? "px-0" : "px-4",
      ].join(" ")}
    >
      <div className="space-y-3">
        {input.title === null ? null : <p className="font-medium text-base">{input.title}</p>}
        <div>{input.details}</div>
        {input.actions === null ? null : (
          <div
            className={["flex flex-wrap gap-2", input.padding === "flush-x" ? "px-4" : ""].join(
              " ",
            )}
          >
            {input.actions}
          </div>
        )}
      </div>
    </article>
  );
}
