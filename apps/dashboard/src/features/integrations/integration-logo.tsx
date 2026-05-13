import type React from "react";

import { resolveIntegrationLogoPath } from "./logo.js";

type IntegrationLogoProps = {
  alt: string;
  className?: string;
  logoKey: string;
};

export function IntegrationLogo(input: IntegrationLogoProps): React.JSX.Element {
  return (
    <img
      alt={input.alt}
      className={input.className}
      src={resolveIntegrationLogoPath({ logoKey: input.logoKey })}
    />
  );
}
