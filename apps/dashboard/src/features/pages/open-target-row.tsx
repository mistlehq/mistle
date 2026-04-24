import { Spinner, textLinkVariants } from "@mistle/ui";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";

type OpenTargetRowProps = {
  disabled?: boolean;
  isLoading?: boolean;
  onClick: () => void;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  title: string;
};

export function OpenTargetRow(input: OpenTargetRowProps): React.JSX.Element {
  return (
    <button
      className="group/open-target-row flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={input.disabled}
      onClick={input.onClick}
      title={input.title}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div
            className={textLinkVariants({
              variant: "listItem",
              className:
                "min-w-0 text-left text-sm group-hover/open-target-row:underline group-focus-visible/open-target-row:underline",
            })}
          >
            {input.primary}
          </div>
          <ArrowSquareOutIcon
            aria-hidden
            className="size-4 shrink-0 opacity-0 transition-[opacity,transform] group-hover/open-target-row:translate-x-0.5 group-hover/open-target-row:opacity-100 group-focus-visible/open-target-row:translate-x-0.5 group-focus-visible/open-target-row:opacity-100"
          />
        </div>
        {input.isLoading ? <Spinner aria-hidden className="size-4 text-stone-500" /> : null}
      </div>
      {input.secondary ?? null}
    </button>
  );
}
