import type { ReactNode } from "react";

type SectionHeaderProps = {
  action?: ReactNode;
  title: string;
};

export function SectionHeader(props: SectionHeaderProps): React.JSX.Element {
  return (
    <div className="min-h-9 items-center gap-3 flex">
      <h2 className="text-sm font-semibold tracking-wide uppercase">{props.title}</h2>
      <div className="bg-border h-px flex-1" />
      {props.action ? <div className="shrink-0">{props.action}</div> : null}
    </div>
  );
}
