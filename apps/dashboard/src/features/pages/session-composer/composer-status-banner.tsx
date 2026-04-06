import type { ChatComposerStatusMessage } from "../../chat/components/chat-composer.js";

const LoadingComposerStatusTextClassName =
  "text-transparent bg-clip-text bg-[length:200%_100%] bg-linear-to-r from-muted-foreground/45 via-foreground to-muted-foreground/45 [animation:composer-status-gradient-wave_4s_linear_infinite]";

export function ComposerStatusBanner(input: {
  statusMessage: ChatComposerStatusMessage;
}): React.JSX.Element {
  const textClassName =
    input.statusMessage.presentation === "loading"
      ? LoadingComposerStatusTextClassName
      : input.statusMessage.variant === "alert"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <div
      aria-live={input.statusMessage.variant === "alert" ? "assertive" : "polite"}
      className="mb-3 px-1 text-sm"
      role={input.statusMessage.variant === "alert" ? "alert" : "status"}
    >
      <span className={textClassName}>{input.statusMessage.message}</span>
    </div>
  );
}
