import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";
import { Badge } from "@mistle/ui";

import { ErrorNotice } from "../auth/error-notice.js";
import type {
  DesignerRuntimeConversationBootstrap,
  DesignerSession,
} from "../designer/designer-service.js";

export type DesignerSessionPageViewProps = {
  bootstrapErrorMessage: string | null;
  bootstrapIsPending: boolean;
  errorMessage: string | null;
  runtimeConversationBootstrap: DesignerRuntimeConversationBootstrap | null;
  session: DesignerSession | null;
  sessionId: string;
};

type RuntimeBootstrapStateProps = Pick<
  DesignerSessionPageViewProps,
  "bootstrapErrorMessage" | "bootstrapIsPending" | "runtimeConversationBootstrap" | "session"
>;

const StartingDesignerSessionStatuses = new Set<string>([
  SandboxInstanceStatuses.PENDING,
  SandboxInstanceStatuses.STARTING,
  SandboxInstanceStatuses.STARTED,
  SandboxInstanceStatuses.INITIALIZING,
  SandboxInstanceStatuses.DEGRADED,
  SandboxInstanceStatuses.RECONNECTING,
  SandboxInstanceStatuses.STOPPING,
]);

function resolveRuntimeBootstrapStatus(input: RuntimeBootstrapStateProps): {
  label: string;
  detail: string;
  tone: "default" | "muted" | "error";
} {
  if (input.bootstrapErrorMessage !== null) {
    return {
      label: "Runtime bootstrap failed",
      detail: input.bootstrapErrorMessage,
      tone: "error",
    };
  }

  if (input.runtimeConversationBootstrap !== null) {
    return {
      label: "Runtime conversation ready",
      detail: `Initial prompt submitted at ${input.runtimeConversationBootstrap.initialPromptSubmittedAt}.`,
      tone: "default",
    };
  }

  if (input.bootstrapIsPending) {
    return {
      label: "Preparing runtime conversation",
      detail: "Submitting the initial prompt to the Designer runtime.",
      tone: "muted",
    };
  }

  if (input.session === null) {
    return {
      label: "Loading Designer session",
      detail: "Runtime bootstrap starts after the session is available.",
      tone: "muted",
    };
  }

  if (input.session.initialPrompt === null) {
    return {
      label: "Initial prompt unavailable",
      detail: "Runtime bootstrap needs a saved initial prompt.",
      tone: "muted",
    };
  }

  if (
    !input.session.connectable &&
    input.session.status !== null &&
    StartingDesignerSessionStatuses.has(input.session.status)
  ) {
    return {
      label: "Waiting for runtime",
      detail: "Runtime bootstrap will start when the Designer sandbox is ready.",
      tone: "muted",
    };
  }

  if (input.session.status === null) {
    return {
      label: "Runtime unavailable",
      detail: input.session.failureMessage ?? "The Designer sandbox is not connectable.",
      tone: "muted",
    };
  }

  if (input.session.status === SandboxInstanceStatuses.FAILED) {
    return {
      label: "Runtime unavailable",
      detail: input.session.failureMessage ?? `The Designer sandbox is ${input.session.status}.`,
      tone: "muted",
    };
  }

  return {
    label: "Runtime bootstrap pending",
    detail: "Runtime bootstrap will start when the session is ready.",
    tone: "muted",
  };
}

function RuntimeBootstrapState(input: RuntimeBootstrapStateProps): React.JSX.Element {
  const status = resolveRuntimeBootstrapStatus(input);
  const className =
    status.tone === "error"
      ? "rounded-lg border border-destructive/30 bg-destructive/10 p-3"
      : "rounded-lg border bg-muted/20 p-3";

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">Runtime bootstrap</p>
        {input.runtimeConversationBootstrap === null ? null : (
          <Badge variant="secondary">ready</Badge>
        )}
      </div>
      <p className="mt-1 text-sm font-medium">{status.label}</p>
      <p className="mt-1 text-sm text-muted-foreground">{status.detail}</p>
      {input.runtimeConversationBootstrap === null ? null : (
        <dl className="mt-3 grid gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Provider conversation</dt>
            <dd className="mt-0.5 break-all font-mono">
              {input.runtimeConversationBootstrap.providerConversationId}
            </dd>
          </div>
          {input.runtimeConversationBootstrap.providerExecutionId === null ? null : (
            <div>
              <dt className="text-muted-foreground">Initial prompt execution</dt>
              <dd className="mt-0.5 break-all font-mono">
                {input.runtimeConversationBootstrap.providerExecutionId}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

export function DesignerSessionPageView(input: DesignerSessionPageViewProps): React.JSX.Element {
  return (
    <div className="grid min-h-svh grid-cols-[minmax(20rem,28rem)_1fr] bg-background">
      <aside className="flex min-h-0 flex-col border-r">
        <div className="border-b p-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="truncate text-base font-medium">Designer</h1>
            {input.session?.status === undefined ? null : (
              <Badge variant="secondary">{input.session.status ?? "unavailable"}</Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">{input.sessionId}</p>
        </div>
        <div className="min-h-0 flex-1 p-4">
          <ErrorNotice message={input.errorMessage} />
          <div className="grid content-start gap-3">
            {input.session?.initialPrompt === null || input.session === null ? null : (
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs font-medium text-muted-foreground">Initial prompt</p>
                <p className="mt-1 text-sm">{input.session.initialPrompt}</p>
              </div>
            )}
            <RuntimeBootstrapState
              bootstrapErrorMessage={input.bootstrapErrorMessage}
              bootstrapIsPending={input.bootstrapIsPending}
              runtimeConversationBootstrap={input.runtimeConversationBootstrap}
              session={input.session}
            />
          </div>
        </div>
      </aside>
      <main className="flex min-w-0 flex-col">
        <div className="flex min-h-14 items-center gap-2 border-b px-4">
          {(input.session?.canvasTabs ?? []).length === 0 ? (
            <span className="text-sm text-muted-foreground">Canvas</span>
          ) : (
            input.session?.canvasTabs.map((tab) => (
              <span className="rounded-md bg-muted px-2 py-1 text-sm" key={tab.id}>
                {tab.title}
              </span>
            ))
          )}
        </div>
        <div className="min-h-0 flex-1 p-4">
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            Canvas
          </div>
        </div>
      </main>
    </div>
  );
}
