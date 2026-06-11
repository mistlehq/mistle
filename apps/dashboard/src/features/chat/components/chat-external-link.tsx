import { cn, textLinkVariants } from "@mistle/ui";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

import { ChatExternalLinkDialog } from "./chat-external-link-dialog.js";
import { isTrustedChatLink } from "./chat-link-safety.js";

type ChatExternalLinkProps = {
  children: ReactNode;
  className?: string;
  href: string;
  style?: CSSProperties;
};

export function ChatExternalLink({
  children,
  className,
  href,
  style,
}: ChatExternalLinkProps): React.JSX.Element {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  function handleConfirm(): void {
    openChatLinkInNewTab(href);
  }

  function handleClick(): void {
    if (isTrustedChatLink(href)) {
      openChatLinkInNewTab(href);
      return;
    }

    setIsDialogOpen(true);
  }

  return (
    <>
      <button
        className={cn(
          textLinkVariants({ variant: "inline" }),
          "appearance-none border-0 bg-transparent p-0 text-inherit cursor-pointer",
          className,
        )}
        onClick={handleClick}
        style={style}
        type="button"
      >
        {children}
      </button>
      <ChatExternalLinkDialog
        isOpen={isDialogOpen}
        onClose={() => {
          setIsDialogOpen(false);
        }}
        onConfirm={handleConfirm}
        url={href}
      />
    </>
  );
}

function openChatLinkInNewTab(href: string): void {
  window.open(href, "_blank", "noopener,noreferrer");
}
