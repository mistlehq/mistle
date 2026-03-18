import type { CodexSessionConnectionState } from "@mistle/integrations-definitions/openai/agent/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@mistle/ui";

import type { ConnectedCodexSession } from "../codex-client/codex-session-types.js";
import { createSessionConfigDialogViewModel } from "./session-config-dialog-view-model.js";

function SessionConfigSection(input: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="space-y-3 border-border/70 border-t pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold">{input.title}</h3>
      {input.children}
    </section>
  );
}

function SessionConfigJsonBlock(input: {
  content: string | null;
  emptyLabel: string;
  isLoading: boolean;
}): React.JSX.Element {
  if (input.isLoading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  if (input.content === null) {
    return <p className="text-muted-foreground text-sm">{input.emptyLabel}</p>;
  }

  return (
    <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap break-words">
      {input.content}
    </pre>
  );
}

export function SessionConfigDialog(input: {
  sandboxInstanceId: string | null;
  agentConnectionState: CodexSessionConnectionState;
  connectedSession: ConnectedCodexSession | null;
  configJson: string | null;
  configRequirementsJson: string | null;
  isReadingConfig: boolean;
  isReadingConfigRequirements: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const viewModel = createSessionConfigDialogViewModel({
    sandboxInstanceId: input.sandboxInstanceId,
    agentConnectionState: input.agentConnectionState,
    connectedSession: input.connectedSession,
  });

  return (
    <Dialog onOpenChange={input.onOpenChange} open={input.isOpen}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
        <DialogHeader variant="sectioned">
          <DialogTitle>Config setup</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <SessionConfigSection title="Session">
            <dl className="grid gap-3 text-sm">
              {viewModel.sessionMetadata.map((entry) => (
                <div className="grid gap-1" key={entry.label}>
                  <dt className="text-muted-foreground">{entry.label}</dt>
                  <dd className={entry.monospace ? "font-mono text-xs break-all" : undefined}>
                    {entry.value}
                  </dd>
                </div>
              ))}
            </dl>
          </SessionConfigSection>

          <SessionConfigSection title="Effective config">
            <SessionConfigJsonBlock
              content={input.configJson}
              emptyLabel="Config has not been loaded yet."
              isLoading={input.isReadingConfig}
            />
          </SessionConfigSection>

          <SessionConfigSection title="Requirements">
            <SessionConfigJsonBlock
              content={input.configRequirementsJson}
              emptyLabel="Config requirements have not been loaded yet."
              isLoading={input.isReadingConfigRequirements}
            />
          </SessionConfigSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}
