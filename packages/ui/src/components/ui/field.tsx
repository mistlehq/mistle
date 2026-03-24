import { cva, type VariantProps } from "class-variance-authority";
import { useMemo } from "react";

import { cn } from "../../lib/utils.js";
import { Label } from "./label.js";
import { Separator } from "./separator.js";

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        "gap-6 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3 flex flex-col",
        className,
      )}
      {...props}
    />
  );
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "mb-3 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base",
        className,
      )}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "gap-7 data-[slot=checkbox-group]:gap-3 [&>[data-slot=field-group]]:gap-4 group/field-group @container/field-group flex w-full flex-col",
        className,
      )}
      {...props}
    />
  );
}

const fieldVariants = cva("data-[invalid=true]:text-destructive group/field flex w-full", {
  variants: {
    orientation: {
      vertical: "gap-2.5 flex-col [&>*]:w-full [&>.sr-only]:w-auto",
      horizontal:
        "flex-row items-start gap-4 [&>[data-slot=field-label],[data-slot=field-header]]:w-40 [&>[data-slot=field-label],[data-slot=field-header]]:shrink-0 [&>[data-slot=field-label],[data-slot=field-header]]:pt-2 [&>[data-slot=field-content]]:min-w-0 has-[>[role=checkbox]+[data-slot=field-content]]:items-center has-[>[role=radio]+[data-slot=field-content]]:items-center has-[>[role=switch]+[data-slot=field-content]]:items-center has-[>[role=checkbox]+[data-slot=field-content]]:[&>[role=checkbox]]:mt-px has-[>[role=radio]+[data-slot=field-content]]:[&>[role=radio]]:mt-px has-[>[role=switch]+[data-slot=field-content]]:[&>[role=switch]]:mt-px",
      responsive:
        "gap-2.5 flex-col [&>*]:w-full [&>.sr-only]:w-auto @md/field-group:flex-row @md/field-group:items-center @md/field-group:[&>*]:w-auto @md/field-group:[&>[data-slot=field-label],[data-slot=field-header]]:flex-auto @md/field-group:has-[>[data-slot=field-header]>[data-slot=field-description]]:items-start @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
    },
    contentWidth: {
      fit: "",
      fill: "",
    },
  },
  compoundVariants: [
    {
      orientation: "horizontal",
      contentWidth: "fit",
      className:
        "[&>[data-slot=field-content]]:flex-1 [&>[data-slot=field-content]]:items-end [&>[data-slot=field-content]>*]:max-w-full [&>[data-slot=field-content]>[data-slot=field-error]]:self-stretch [&>[data-slot=field-content]_[data-slot=select-trigger]:not([class*='w-'])]:w-auto [&>[data-slot=field-content]_[data-slot=select-trigger]:not([class*='min-w-'])]:min-w-40 [&>[data-slot=field-content]_[data-slot=select-trigger]]:max-w-full",
    },
    {
      orientation: "horizontal",
      contentWidth: "fill",
      className: "[&>[data-slot=field-content]]:flex-1",
    },
  ],
  defaultVariants: {
    contentWidth: "fit",
    orientation: "vertical",
  },
});

function Field({
  className,
  contentWidth,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-content-width={contentWidth}
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ contentWidth, orientation }), className)}
      {...props}
    />
  );
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn("group/field-content flex flex-1 flex-col gap-1 leading-snug", className)}
      {...props}
    />
  );
}

function FieldHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-header"
      className={cn("flex flex-col leading-snug", className)}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "has-data-checked:bg-primary/5 has-data-checked:border-primary dark:has-data-checked:bg-primary/10 gap-2 group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border [&>*]:data-[slot=field]:p-3 group/field-label peer/field-label flex w-fit leading-snug",
        "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        "gap-2 text-sm font-medium group-data-[disabled=true]/field:opacity-50 flex w-fit items-center leading-snug",
        className,
      )}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-muted-foreground text-left text-sm [[data-variant=legend]+&]:-mt-1.5 leading-normal font-normal group-has-[[data-orientation=horizontal]]/field:text-balance",
        "[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4",
        className,
      )}
      {...props}
    />
  );
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  children?: React.ReactNode;
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        "-my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2 relative",
        className,
      )}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="text-muted-foreground px-2 bg-background relative mx-auto block w-fit"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  );
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>;
}) {
  const content = useMemo(() => {
    if (children) {
      return children;
    }

    if (!errors?.length) {
      return null;
    }

    const uniqueErrors = [...new Map(errors.map((error) => [error?.message, error])).values()];

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message;
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueErrors.map((error, index) => error?.message && <li key={index}>{error.message}</li>)}
      </ul>
    );
  }, [children, errors]);

  if (!content) {
    return null;
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("text-destructive text-sm font-normal", className)}
      {...props}
    >
      {content}
    </div>
  );
}

export {
  Field,
  FieldHeader,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
};
