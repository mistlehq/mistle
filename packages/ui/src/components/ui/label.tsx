import * as React from "react";

import { cn } from "../../lib/utils.js";
import { detailLabelTextClassName } from "./label-text.js";

function Label({ className, htmlFor, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      htmlFor={htmlFor}
      className={cn(
        detailLabelTextClassName,
        "gap-2 leading-snug group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50 flex items-start select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
