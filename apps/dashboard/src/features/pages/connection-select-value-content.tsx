import type React from "react";

import { resolveIntegrationLogoPath } from "../integrations/logo.js";

export function ConnectionSelectValueContent(input: {
  connectionDisplayName: string;
  targetDisplayName?: string | undefined;
  targetLogoKey?: string | undefined;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {input.targetLogoKey === undefined ? null : (
        <img
          alt={`${input.targetDisplayName ?? "Integration"} logo`}
          className="size-4 shrink-0 rounded-sm"
          src={resolveIntegrationLogoPath({ logoKey: input.targetLogoKey })}
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
