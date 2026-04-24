import * as React from "react";

import { cn } from "../../lib/utils.js";
import { Badge } from "./badge.js";
import { DetailLabel } from "./detail-label.js";

export type BadgeListFieldItem = {
  id: React.Key;
  label: React.ReactNode;
};

type BadgeListFieldProps = React.ComponentProps<"div"> & {
  items: readonly BadgeListFieldItem[];
  label?: React.ReactNode;
  badgeClassName?: string;
};

function BadgeListField({
  badgeClassName,
  className,
  items,
  label,
  ...props
}: BadgeListFieldProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={cn("gap-1.5 flex flex-col", className)} data-slot="badge-list-field" {...props}>
      {label === undefined ? null : (
        <DetailLabel as="p" data-slot="badge-list-label">
          {label}
        </DetailLabel>
      )}
      <div className="flex flex-wrap gap-2" data-slot="badge-list-items">
        {items.map((item) => (
          <Badge
            className={cn("h-auto rounded-full px-2.5 py-1 text-xs", badgeClassName)}
            key={item.id}
            variant="outline"
          >
            {item.label}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export { BadgeListField };
