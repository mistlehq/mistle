import { systemScheduler } from "@mistle/time";
import { Button, cn } from "@mistle/ui";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";

import { getRuntimeEnv, type RuntimeEnv } from "../../lib/runtime-env.js";
import { toRecord } from "../../lib/unknown-record.js";

type RouteErrorDisplay = {
  title: string;
  description: string;
  detail: string | null;
  showSignInAction: boolean;
};
type ResolveRouteErrorDisplayOptions = {
  showDiagnostics: boolean;
};
const COPY_SUCCESS_DISPLAY_MS = 1200;

function readRouteResponseMessage(data: unknown): string | null {
  if (typeof data === "string") {
    const message = data.trim();
    return message.length > 0 ? message : null;
  }

  const record = toRecord(data);
  if (record !== null) {
    const message = record["message"];
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return null;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildRouteErrorDetail(error: {
  status: number;
  statusText: string;
  data: unknown;
}): string {
  const statusLine =
    error.statusText.trim().length > 0
      ? `Route error: ${error.status} ${error.statusText}`
      : `Route error: ${error.status}`;

  return `${statusLine}\n\nResponse data:\n${stringifyUnknown(error.data)}`;
}

function buildThrownErrorDetail(error: Error): string {
  const lines = [
    `Error: ${error.name}`,
    `Message: ${error.message}`,
    error.stack ? `Stack:\n${error.stack}` : null,
  ];

  const cause = error.cause;
  if (cause !== undefined) {
    lines.push(`Cause:\n${stringifyUnknown(cause)}`);
  }

  return lines.filter((line): line is string => line !== null).join("\n\n");
}

export function resolveRouteErrorDisplay(
  error: unknown,
  options: ResolveRouteErrorDisplayOptions,
): RouteErrorDisplay {
  if (isRouteErrorResponse(error)) {
    const routeMessage = readRouteResponseMessage(error.data);
    const detail = options.showDiagnostics ? buildRouteErrorDetail(error) : null;

    if (error.status === 401) {
      return {
        title: "Sign in required",
        description: routeMessage ?? "Your session has expired. Sign in again to continue.",
        detail,
        showSignInAction: true,
      };
    }

    if (error.status === 403) {
      return {
        title: "Access denied",
        description: routeMessage ?? "You do not have permission to view this page.",
        detail,
        showSignInAction: false,
      };
    }

    if (error.status === 404) {
      return {
        title: "Page not found",
        description: routeMessage ?? "The requested page could not be found.",
        detail,
        showSignInAction: false,
      };
    }

    return {
      title: "Request failed",
      description:
        routeMessage ??
        (error.statusText.trim().length > 0
          ? error.statusText
          : "The dashboard could not load this page right now."),
      detail,
      showSignInAction: false,
    };
  }

  if (error instanceof Error) {
    return {
      title: "Unexpected application error",
      description: "Something went wrong while loading this page.",
      detail: options.showDiagnostics ? buildThrownErrorDetail(error) : null,
      showSignInAction: false,
    };
  }

  return {
    title: "Unexpected application error",
    description: "Something went wrong while loading this page.",
    detail: options.showDiagnostics ? `Unknown error value:\n${stringifyUnknown(error)}` : null,
    showSignInAction: false,
  };
}

export function shouldRenderRouteErrorDiagnostics(runtimeEnv: RuntimeEnv): boolean {
  return runtimeEnv.isDevelopment;
}

type RouteErrorBoundaryProps = {
  runtimeEnv?: RuntimeEnv;
};

export function RouteErrorBoundary({ runtimeEnv }: RouteErrorBoundaryProps): React.JSX.Element {
  const error = useRouteError();
  const navigate = useNavigate();
  const resolvedRuntimeEnv = runtimeEnv ?? getRuntimeEnv();
  const showDiagnostics = shouldRenderRouteErrorDiagnostics(resolvedRuntimeEnv);
  const display = resolveRouteErrorDisplay(error, { showDiagnostics });
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopyDetails(): Promise<void> {
    if (display.detail === null) {
      return;
    }

    try {
      await navigator.clipboard.writeText(display.detail);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  useEffect(() => {
    setCopyState("idle");
  }, [display.detail]);

  useEffect(() => {
    if (copyState !== "copied") {
      return;
    }

    const handle = systemScheduler.schedule(() => {
      setCopyState("idle");
    }, COPY_SUCCESS_DISPLAY_MS);

    return () => {
      systemScheduler.cancel(handle);
    };
  }, [copyState]);

  return (
    <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
      <section className="mx-auto flex min-h-svh w-full max-w-6xl items-center px-4 py-8">
        <div className="bg-card text-card-foreground flex h-[72svh] w-full max-h-[72svh] flex-col rounded-lg border shadow-sm">
          <header className="p-6">
            <h1 className="text-xl font-semibold">{display.title}</h1>
            <p className="text-muted-foreground mt-2 text-sm">{display.description}</p>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-6">
            {display.detail !== null ? (
              <div className="bg-muted relative min-h-0 flex-1 rounded-md border">
                <Button
                  aria-label="Copy error details"
                  className="absolute top-2 right-2 z-10"
                  onClick={() => void handleCopyDetails()}
                  size="icon-sm"
                  title="Copy details"
                  type="button"
                  variant="ghost"
                >
                  {copyState === "copied" ? (
                    <CheckIcon className="size-4 text-emerald-600 transition-colors duration-200" />
                  ) : (
                    <CopyIcon
                      className={cn(
                        "size-4 transition-colors duration-200",
                        copyState === "failed" ? "text-destructive" : null,
                      )}
                    />
                  )}
                </Button>
                <pre className="text-muted-foreground h-full overflow-auto p-3 text-xs whitespace-pre-wrap break-words">
                  {display.detail}
                </pre>
                {copyState === "failed" ? (
                  <p className="text-destructive mt-2 text-xs">
                    Could not copy details automatically. Select and copy manually.
                  </p>
                ) : null}
              </div>
            ) : null}
            {display.showSignInAction ? (
              <Button
                onClick={() => void navigate("/auth/login", { replace: true })}
                type="button"
                variant="secondary"
              >
                Sign in
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
