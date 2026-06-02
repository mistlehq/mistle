import { Button, cn, CopyableValue } from "@mistle/ui";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";
import { z } from "zod";

import { getRuntimeEnv, type RuntimeEnv } from "../../lib/runtime-env.js";
import { HttpApiError } from "../api/http-api-error.js";

export type RouteErrorDisplay = {
  title: string;
  description: string;
  detail: string | null;
  primaryAction: RouteErrorPrimaryAction;
};
export type RouteErrorPrimaryAction = "refresh" | "signIn" | null;
type ResolveRouteErrorDisplayOptions = {
  showDiagnostics: boolean;
};
const RouteErrorMessageSchema = z.object({
  message: z.string().trim().min(1),
});

function readRouteResponseMessage(data: unknown): string | null {
  if (typeof data === "string") {
    const message = data.trim();
    return message.length > 0 ? message : null;
  }

  const parsedMessage = RouteErrorMessageSchema.safeParse(data);
  if (parsedMessage.success) {
    return parsedMessage.data.message;
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

function buildHttpApiErrorDetail(error: HttpApiError): string {
  return buildRouteErrorDetail({
    status: error.status,
    statusText: error.message,
    data: error.body,
  });
}

function resolveHttpApiErrorDisplay(
  error: HttpApiError,
  options: ResolveRouteErrorDisplayOptions,
): RouteErrorDisplay {
  const detail = options.showDiagnostics ? buildHttpApiErrorDetail(error) : null;

  if (error.status === 401) {
    return {
      title: "Sign in required",
      description: error.message,
      detail,
      primaryAction: "signIn",
    };
  }

  if (error.status === 403) {
    return {
      title: "Access denied",
      description: error.message,
      detail,
      primaryAction: null,
    };
  }

  if (error.status === 404) {
    return {
      title: "Page not found",
      description: error.message,
      detail,
      primaryAction: null,
    };
  }

  return {
    title: "Request failed",
    description: error.message,
    detail,
    primaryAction: null,
  };
}

function resolveUnexpectedApplicationErrorDisplay(input: {
  detail: string | null;
  showDiagnostics: boolean;
}): RouteErrorDisplay {
  if (input.showDiagnostics) {
    return {
      title: "Unexpected application error",
      description: "Something went wrong while loading this page.",
      detail: input.detail,
      primaryAction: null,
    };
  }

  return {
    title: "Refresh dashboard",
    description: "Something changed while this tab was open. Refresh to continue.",
    detail: null,
    primaryAction: "refresh",
  };
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
        primaryAction: "signIn",
      };
    }

    if (error.status === 403) {
      return {
        title: "Access denied",
        description: routeMessage ?? "You do not have permission to view this page.",
        detail,
        primaryAction: null,
      };
    }

    if (error.status === 404) {
      return {
        title: "Page not found",
        description: routeMessage ?? "The requested page could not be found.",
        detail,
        primaryAction: null,
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
      primaryAction: null,
    };
  }

  if (error instanceof HttpApiError) {
    return resolveHttpApiErrorDisplay(error, options);
  }

  if (error instanceof Error) {
    return resolveUnexpectedApplicationErrorDisplay({
      detail: options.showDiagnostics ? buildThrownErrorDetail(error) : null,
      showDiagnostics: options.showDiagnostics,
    });
  }

  return resolveUnexpectedApplicationErrorDisplay({
    detail: options.showDiagnostics ? `Unknown error value:\n${stringifyUnknown(error)}` : null,
    showDiagnostics: options.showDiagnostics,
  });
}

export function shouldRenderRouteErrorDiagnostics(runtimeEnv: RuntimeEnv): boolean {
  return runtimeEnv.isDevelopment;
}

type RouteErrorBoundaryProps = {
  runtimeEnv?: RuntimeEnv;
};

type RouteErrorBoundaryViewProps = {
  display: RouteErrorDisplay;
  onRefresh: () => void;
  onSignIn: () => void;
};

export function RouteErrorBoundary({ runtimeEnv }: RouteErrorBoundaryProps): React.JSX.Element {
  const error = useRouteError();
  const navigate = useNavigate();
  const resolvedRuntimeEnv = runtimeEnv ?? getRuntimeEnv();
  const showDiagnostics = shouldRenderRouteErrorDiagnostics(resolvedRuntimeEnv);
  const display = resolveRouteErrorDisplay(error, { showDiagnostics });
  return (
    <RouteErrorBoundaryView
      display={display}
      onRefresh={() => globalThis.location.reload()}
      onSignIn={() => void navigate("/auth/login", { replace: true })}
    />
  );
}

export function RouteErrorBoundaryView({
  display,
  onRefresh,
  onSignIn,
}: RouteErrorBoundaryViewProps): React.JSX.Element {
  const detail = display.detail;
  const hasDetail = detail !== null;
  const primaryAction =
    display.primaryAction === "refresh" ? (
      <Button onClick={onRefresh} type="button">
        Refresh now
      </Button>
    ) : display.primaryAction === "signIn" ? (
      <Button onClick={onSignIn} type="button">
        Sign in
      </Button>
    ) : null;

  return (
    <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
      <section className="mx-auto flex min-h-svh w-full max-w-6xl items-center px-4 py-8">
        <div
          className={cn(
            "bg-card text-card-foreground flex w-full flex-col rounded-lg border shadow-sm",
            hasDetail ? "h-[72svh] max-h-[72svh]" : "min-h-40",
          )}
        >
          <header className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold">{display.title}</h1>
              <p className="text-muted-foreground mt-2 text-sm">{display.description}</p>
            </div>
            {primaryAction !== null ? (
              <div className="shrink-0 sm:pt-1">{primaryAction}</div>
            ) : null}
          </header>
          {hasDetail ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-6">
              <CopyableValue
                copiedTitle="Copied"
                copyAriaLabel="Copy error details"
                copyTitle="Copy details"
                failureMessage="Could not copy details automatically. Select and copy manually."
                value={detail}
                variant="panel"
              />
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
