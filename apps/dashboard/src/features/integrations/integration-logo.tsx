import type React from "react";

import { resolveDarkIntegrationLogoPath, resolveIntegrationLogoPath } from "./logo.js";

type IntegrationLogoProps = {
  alt: string;
  className?: string;
  logoKey: string;
};

export function IntegrationLogo(input: IntegrationLogoProps): React.JSX.Element {
  const lightLogoPath = resolveIntegrationLogoPath({ logoKey: input.logoKey });
  const darkLogoPath = resolveDarkIntegrationLogoPath({ logoKey: input.logoKey });

  return (
    <picture>
      {darkLogoPath === undefined ? null : (
        <source media="(prefers-color-scheme: dark)" srcSet={darkLogoPath} />
      )}
      <img alt={input.alt} className={input.className} src={lightLogoPath} />
    </picture>
  );
}
