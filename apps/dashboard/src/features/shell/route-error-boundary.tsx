import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";

import { getRuntimeEnv, type RuntimeEnv } from "../../lib/runtime-env.js";

type RouteErrorDisplay = {
  title: string;
  description: string;
  detail: string | null;
  showSignInAction: boolean;
};
type ResolveRouteErrorDisplayOptions = {
  showDiagnostics: boolean;
};

function readRouteResponseMessage(data: unknown): string | null {
  if (typeof data === "string") {
    const message = data.trim();
    return message.length > 0 ? message : null;
  }

  if (typeof data === "object" && data !== null) {
    const message = Reflect.get(data, "message");
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

  const cause = Reflect.get(error, "cause");
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

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl items-center justify-center px-4 py-8">
      <section className="bg-card text-card-foreground w-full rounded-lg border p-5 shadow-sm">
        <h1 className="text-xl font-semibold">{display.title}</h1>
        <p className="text-muted-foreground mt-2 text-sm">{display.description}</p>
        {display.detail !== null ? (
          <pre className="bg-muted mt-4 max-h-80 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap break-words">
            {display.detail}
          </pre>
        ) : null}
        {display.showSignInAction ? (
          <button
            className="bg-primary text-primary-foreground mt-4 inline-flex h-9 items-center rounded-md px-3 text-sm"
            onClick={() => void navigate("/auth/login", { replace: true })}
            type="button"
          >
            Sign in
          </button>
        ) : null}
      </section>
    </main>
  );
}
