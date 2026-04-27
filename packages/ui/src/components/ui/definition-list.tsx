import * as React from "react";

import { cn } from "../../lib/utils.js";
import { DetailLabel } from "./detail-label.js";

export type DefinitionListItem = {
  id: React.Key;
  label: React.ReactNode;
  value: React.ReactNode;
};

type DefinitionListProps = React.ComponentProps<"dl"> & {
  items: readonly DefinitionListItem[];
  itemClassName?: string;
};

function DefinitionList({ className, itemClassName, items, ...props }: DefinitionListProps) {
  return (
    <dl
      className={cn("grid grid-cols-1 gap-4 md:grid-cols-2", className)}
      data-slot="definition-list"
      {...props}
    >
      {items.map((item) => (
        <div
          className={cn("gap-1.5 flex flex-col", itemClassName)}
          data-slot="definition-list-item"
          key={item.id}
        >
          <DetailLabel as="dt" data-slot="definition-list-label">
            {item.label}
          </DetailLabel>
          <dd className="break-all text-sm" data-slot="definition-list-value">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export { DefinitionList };
