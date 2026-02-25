"use client";

import {
  CheckCircleIcon,
  InfoIcon,
  WarningIcon,
  XCircleIcon,
  SpinnerIcon,
} from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ theme: themeProp, ...props }: ToasterProps) => {
  const { theme: resolvedTheme } = useTheme();
  const theme =
    themeProp ??
    (resolvedTheme === "light" || resolvedTheme === "dark" || resolvedTheme === "system"
      ? resolvedTheme
      : "system");
  const styles: React.CSSProperties & Record<`--${string}`, string> = {
    "--normal-bg": "var(--popover)",
    "--normal-text": "var(--popover-foreground)",
    "--normal-border": "var(--border)",
    "--border-radius": "var(--radius)",
  };

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CheckCircleIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <WarningIcon className="size-4" />,
        error: <XCircleIcon className="size-4" />,
        loading: <SpinnerIcon className="size-4 animate-spin" />,
      }}
      style={styles}
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
