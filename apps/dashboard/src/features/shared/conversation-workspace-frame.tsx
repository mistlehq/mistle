import { cn } from "@mistle/ui";

type ConversationWorkspaceHeaderProps = {
  actions?: React.ReactNode;
  className?: string;
  leadingControl?: React.ReactNode;
  title: React.ReactNode;
};

type ConversationWorkspaceFrameProps = ConversationWorkspaceHeaderProps & {
  children: React.ReactNode;
};

export function ConversationWorkspaceFrame(
  input: ConversationWorkspaceFrameProps,
): React.JSX.Element {
  const { children, ...headerProps } = input;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ConversationWorkspaceHeader {...headerProps} />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export function ConversationWorkspaceHeader(
  input: ConversationWorkspaceHeaderProps,
): React.JSX.Element {
  return (
    <header
      className={cn(
        "bg-background/80 flex h-12 shrink-0 items-center border-b px-2.5 backdrop-blur-sm sm:px-4",
        input.className,
      )}
    >
      {input.leadingControl === undefined ? null : (
        <div className="mr-1.5 flex shrink-0 items-center sm:mr-2">{input.leadingControl}</div>
      )}
      <div className="min-w-0 flex-1">{input.title}</div>
      {input.actions === undefined ? null : (
        <div className="ml-2 flex shrink-0 items-center gap-1.5 sm:ml-4 sm:gap-2">
          {input.actions}
        </div>
      )}
    </header>
  );
}
