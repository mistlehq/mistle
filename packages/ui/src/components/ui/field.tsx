import { InfoIcon } from "@phosphor-icons/react";
import { cva, type VariantProps } from "class-variance-authority";
import { useMemo } from "react";

import { cn } from "../../lib/utils.js";
import { Label } from "./label.js";
import { Separator } from "./separator.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

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

/** Label above control, full-width children; base layout for `horizontal` on narrow viewports. */
const fieldOrientationVerticalClasses =
  "gap-1.5 flex-col [&>*]:w-full [&>.sr-only]:w-auto [&_[data-slot=select-trigger]]:w-full";

/** Row layout from `md` viewport breakpoint. */
const fieldOrientationHorizontalClasses =
  "md:flex-row md:items-start md:gap-4 md:[&>[data-slot=field-label],&>[data-slot=field-header]]:w-40 md:[&>[data-slot=field-label],&>[data-slot=field-header]]:shrink-0 md:[&>[data-slot=field-label]]:self-center md:[&>[data-slot=field-header]:not(:has([data-slot=field-description]))]:self-center md:[&>[data-slot=field-header]:has([data-slot=field-description])]:pt-2 md:has-[>[data-slot=field-content]>[data-slot=checkbox-group]]:[&>[data-slot=field-label],&>[data-slot=field-header]]:pt-0 md:[&>[data-slot=field-content]]:min-w-0 md:[&_[data-slot=select-trigger]]:w-fit md:has-[>[role=checkbox]+[data-slot=field-content]]:items-center md:has-[>[role=radio]+[data-slot=field-content]]:items-center md:has-[>[role=switch]+[data-slot=field-content]]:items-center md:has-[>[role=checkbox]+[data-slot=field-content]]:[&>[role=checkbox]]:mt-px md:has-[>[role=radio]+[data-slot=field-content]]:[&>[role=radio]]:mt-px md:has-[>[role=switch]+[data-slot=field-content]]:[&>[role=switch]]:mt-px";

const fieldVariants = cva("data-[invalid=true]:text-destructive group/field flex w-full", {
  variants: {
    orientation: {
      vertical: fieldOrientationVerticalClasses,
      horizontal: cn(fieldOrientationVerticalClasses, fieldOrientationHorizontalClasses),
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
        "md:[&>[data-slot=field-content]]:flex-1 md:[&>[data-slot=field-content]]:items-end [&>[data-slot=field-content]>*]:max-w-full md:[&>[data-slot=field-content]>[data-slot=field-error]]:self-stretch md:[&>[data-slot=field-content]_[data-slot=select-trigger]:not([class*='w-'])]:w-auto md:[&>[data-slot=field-content]_[data-slot=select-trigger]:not([class*='min-w-'])]:min-w-40 md:[&>[data-slot=field-content]_[data-slot=select-trigger]]:max-w-full",
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

type FieldLabelProps = React.ComponentProps<typeof Label> & {
  required?: boolean;
};

function FieldLabel({ children, className, required = false, ...props }: FieldLabelProps) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "has-data-checked:bg-primary/5 has-data-checked:border-primary dark:has-data-checked:bg-primary/10 gap-2 group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border [&>*]:data-[slot=field]:p-3 group/field-label peer/field-label flex w-fit leading-snug",
        "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <>
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
          <span className="sr-only">required</span>
        </>
      ) : null}
    </Label>
  );
}

type FieldLabelWithTooltipProps = FieldLabelProps & {
  tooltip: React.ReactNode;
  tooltipContentClassName?: string;
  tooltipLabel: string;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
};

function FieldLabelWithTooltip({
  children,
  tooltip,
  tooltipContentClassName,
  tooltipLabel,
  tooltipSide = "top",
  ...props
}: FieldLabelWithTooltipProps) {
  return (
    <div className="flex items-center gap-1.5">
      <FieldLabel {...props}>{children}</FieldLabel>
      <Tooltip delay={0}>
        <TooltipTrigger
          aria-label={tooltipLabel}
          render={
            <button
              className="text-foreground/80 hover:text-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-sm"
              type="button"
            />
          }
        >
          <InfoIcon aria-hidden className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent
          className={cn("max-w-64 text-left", tooltipContentClassName)}
          side={tooltipSide}
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
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

type FieldTitleWithTooltipProps = React.ComponentProps<typeof FieldTitle> & {
  tooltip: React.ReactNode;
  tooltipContentClassName?: string;
  tooltipLabel: string;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
};

function FieldTitleWithTooltip({
  children,
  tooltip,
  tooltipContentClassName,
  tooltipLabel,
  tooltipSide = "top",
  ...props
}: FieldTitleWithTooltipProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <FieldTitle {...props}>{children}</FieldTitle>
      <Tooltip delay={0}>
        <TooltipTrigger
          aria-label={tooltipLabel}
          render={
            <button
              className="text-foreground/80 hover:text-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-sm"
              type="button"
            />
          }
        >
          <InfoIcon aria-hidden className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent
          className={cn("max-w-64 text-left", tooltipContentClassName)}
          side={tooltipSide}
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-muted-foreground text-left text-sm [[data-variant=legend]+&]:-mt-1.5 leading-normal font-normal",
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
  FieldLabelWithTooltip,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
  FieldTitleWithTooltip,
};
