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
      <button
        className={["appearance-none border-0 bg-transparent p-0 text-inherit", className]
          .filter(Boolean)
          .join(" ")}
        onClick={() => {
          setIsDialogOpen(true);
        }}
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
