import type { ChatComposerStatusMessage } from "../../chat/components/chat-composer.js";
import { SessionComposerActivityRow } from "./session-composer-activity-row.js";

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

  return (
    <div aria-live={input.statusMessage.variant === "alert" ? "assertive" : "polite"}>
      <SessionComposerActivityRow
        active={input.statusMessage.presentation === "loading"}
        role={input.statusMessage.variant === "alert" ? "alert" : "status"}
        text={input.statusMessage.message}
      />
    </div>
  );
}
