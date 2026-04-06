import { AnimatedStatusText } from "@mistle/ui";

import type { ChatComposerStatusMessage } from "../../chat/components/chat-composer.js";

export function ComposerStatusBanner(input: {
  statusMessage: ChatComposerStatusMessage;
}): React.JSX.Element {
  if (input.statusMessage.presentation === "notice") {
    return (
      <div
        aria-live={input.statusMessage.variant === "alert" ? "assertive" : "polite"}
        className={[
          "mb-3 rounded-md border px-3 py-2 text-sm",
          input.statusMessage.variant === "alert"
            ? "border-destructive/30 bg-destructive/5 text-destructive"
            : "border-border/70 bg-muted/30 text-muted-foreground",
        ].join(" ")}
        role={input.statusMessage.variant === "alert" ? "alert" : "status"}
      >
        {input.statusMessage.message}
      </div>
    );
  }

  const textClassName = input.statusMessage.variant === "alert" ? "text-destructive" : undefined;

  return (
    <div
      aria-live={input.statusMessage.variant === "alert" ? "assertive" : "polite"}
      className="mb-3 px-1 text-sm"
      role={input.statusMessage.variant === "alert" ? "alert" : "status"}
    >
      <AnimatedStatusText
        active={input.statusMessage.presentation === "loading"}
        className={textClassName}
      >
        {input.statusMessage.message}
      </AnimatedStatusText>
    </div>
  );
}
