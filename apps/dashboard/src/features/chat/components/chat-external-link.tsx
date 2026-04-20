import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

import { ChatExternalLinkDialog } from "./chat-external-link-dialog.js";

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
    window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <a
        className={["appearance-none border-0 bg-transparent p-0 text-inherit", className]
          .filter(Boolean)
          .join(" ")}
        href={href}
        onClick={(event) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }

          event.preventDefault();
          setIsDialogOpen(true);
        }}
        style={style}
      >
        {children}
      </a>
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
