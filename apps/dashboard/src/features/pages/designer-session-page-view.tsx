import { Badge } from "@mistle/ui";

import { ErrorNotice } from "../auth/error-notice.js";
import type { DesignerSession } from "../designer/designer-service.js";

export type DesignerSessionPageViewProps = {
  errorMessage: string | null;
  session: DesignerSession | null;
  sessionId: string;
};

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
            <div className="flex min-h-72 items-center justify-center rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
              Chat
            </div>
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
