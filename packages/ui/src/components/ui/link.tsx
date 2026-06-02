import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.js";

const textLinkVariants = cva(
  "cursor-default rounded-[2px] outline-none transition-[color,text-decoration-thickness,text-underline-offset] duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        inline:
          "text-primary underline decoration-[1px] underline-offset-[0.18em] hover:decoration-[1.5px] hover:underline-offset-[0.24em] focus-visible:decoration-[1.5px] focus-visible:underline-offset-[0.24em]",
        listItem:
          "text-foreground font-medium no-underline hover:underline focus-visible:underline",
        subtle:
          "text-muted-foreground no-underline hover:text-foreground focus-visible:text-foreground",
      },
    },
    defaultVariants: {
      variant: "inline",
    },
  },
);

type TextLinkProps = useRender.ComponentProps<"a"> &
  VariantProps<typeof textLinkVariants> & {
    opensInNewWindow?: boolean;
  };

function TextLink({
  children,
  className,
  opensInNewWindow = false,
  rel,
  render,
  target,
  variant = "inline",
  ...props
}: TextLinkProps): React.JSX.Element {
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      {
        className: cn(
          textLinkVariants({ variant }),
          opensInNewWindow
            ? "inline-flex min-w-0 items-baseline gap-1 has-data-[icon=inline-end]:pr-0.5"
            : null,
          className,
        ),
        rel: opensInNewWindow ? "noreferrer" : rel,
        target: opensInNewWindow ? "_blank" : target,
        children: (
          <>
            {children}
            {opensInNewWindow ? (
              <ArrowSquareOutIcon
                aria-hidden
                className="size-[0.95em] shrink-0 translate-y-[0.12em]"
                data-icon="inline-end"
              />
            ) : null}
          </>
        ),
      },
      props,
    ),
    ...(render === undefined ? {} : { render }),
    state: {
      slot: "text-link",
      variant,
    },
  });
}

export { TextLink, textLinkVariants };
