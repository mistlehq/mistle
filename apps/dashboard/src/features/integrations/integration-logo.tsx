import { cn } from "@mistle/ui";
import type React from "react";

import { resolveIntegrationLogoPaths } from "./logo.js";

type IntegrationLogoProps = {
  alt: string;
  className?: string;
  logoKey: string;
};

export function IntegrationLogo(input: IntegrationLogoProps): React.JSX.Element {
  const logoPaths = resolveIntegrationLogoPaths({ logoKey: input.logoKey });
  const logoClassName = cn("size-5 shrink-0 object-contain", input.className);

  if (logoPaths.dark === null) {
    return <img alt={input.alt} className={logoClassName} src={logoPaths.light} />;
  }

  const accessibilityProps =
    input.alt.length === 0
      ? {
          "aria-hidden": true,
        }
      : {
          "aria-label": input.alt,
          role: "img",
        };

  return (
    <span
      className={cn("inline-flex size-5 shrink-0 items-center justify-center", input.className)}
      {...accessibilityProps}
    >
      <img
        alt=""
        aria-hidden="true"
        className="size-full object-contain dark:hidden"
        src={logoPaths.light}
      />
      <img
        alt=""
        aria-hidden="true"
        className="hidden size-full object-contain dark:inline-block"
        src={logoPaths.dark}
      />
    </span>
  );
}
