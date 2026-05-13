import type React from "react";

import { IntegrationLogo } from "../integrations/integration-logo.js";

export function ConnectionSelectValueContent(input: {
  connectionDisplayName: string;
  targetDisplayName?: string | undefined;
  targetLogoKey?: string | undefined;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {input.targetLogoKey === undefined ? null : (
        <IntegrationLogo
          alt={`${input.targetDisplayName ?? "Integration"} logo`}
          className="size-4 shrink-0 rounded-sm"
          logoKey={input.targetLogoKey}
        />
      )}
      {input.targetDisplayName === undefined ? (
        <span className="truncate">{input.connectionDisplayName}</span>
      ) : (
        <span className="truncate">
          {input.targetDisplayName} - {input.connectionDisplayName}
        </span>
      )}
    </div>
  );
}
