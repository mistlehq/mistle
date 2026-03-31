import { Button } from "@mistle/ui";
import type React from "react";

type SessionPrimaryPanelStatusAction = {
  label: string;
  onClick: () => void;
};

type SessionPrimaryPanelStatusCardProps = {
  title: string;
  description: React.ReactNode;
  action?: SessionPrimaryPanelStatusAction;
  tone?: "default" | "destructive";
};

export function SessionPrimaryPanelStatusCard(
  props: SessionPrimaryPanelStatusCardProps,
): React.JSX.Element {
  const borderClass =
    props.tone === "destructive" ? "border-rose-200 bg-rose-50" : "border-stone-200 bg-white";
  const descriptionClass = props.tone === "destructive" ? "text-rose-700" : "text-stone-600";

  return (
    <section
      className={`flex min-h-[24rem] items-center justify-center rounded-xl border ${borderClass} px-6 py-10`}
    >
      <div className="flex max-w-lg flex-col items-start gap-3">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-stone-950">{props.title}</h2>
          <div className={`text-sm leading-6 ${descriptionClass}`}>{props.description}</div>
        </div>
        {props.action === undefined ? null : (
          <Button onClick={props.action.onClick} type="button" variant="outline">
            {props.action.label}
          </Button>
        )}
      </div>
    </section>
  );
}
