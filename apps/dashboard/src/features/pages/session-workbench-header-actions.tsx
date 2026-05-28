import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  Spinner,
  SelectTrigger,
  SelectValue,
  CssBreakpointVariables,
  useIsBelowBreakpoint,
} from "@mistle/ui";
import {
  CpuIcon,
  DotsThreeIcon,
  GitBranchIcon,
  GitDiffIcon,
  ListBulletsIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import { IntegrationLogo } from "../integrations/integration-logo.js";
import { resolveSelectableValue } from "../shared/select-value.js";

export type SessionWorkbenchHeaderRepositoryOption = {
  value: string;
  label: string;
};

type SessionWorkbenchHeaderRepositoryControl = {
  ariaLabel: string;
  disabled?: boolean;
  errorMessage?: string;
  isRefreshing?: boolean;
  onOpenChange?: (open: boolean) => void;
  onValueChange: (nextValue: string) => void;
  options: ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
  selectedValue: string | null;
  title?: string;
};

type SessionWorkbenchHeaderButtonControl = {
  ariaLabel: string;
  className: string;
  disabled: boolean;
  onClick: () => void;
  pressed: boolean;
  title: string;
};

type SessionWorkbenchHeaderMobileSurfaceControl = {
  disabled: boolean;
  onOpen: () => void;
  surface: React.ReactNode;
  title: string;
};

export function SessionWorkbenchHeaderActions(input: {
  cliControl: SessionWorkbenchHeaderButtonControl;
  diffControl: SessionWorkbenchHeaderButtonControl;
  mobilePortAccessControl?: SessionWorkbenchHeaderMobileSurfaceControl;
  mobileConversationNavigatorControl?: SessionWorkbenchHeaderMobileSurfaceControl;
  portAccessControl?: React.ReactNode;
  repositoryControl?: SessionWorkbenchHeaderRepositoryControl;
  status: {
    className?: string;
    kind: "connected" | "error" | "not_connected";
    label: string;
    variant?: "outline" | "secondary";
  };
  conversationControl?: SessionWorkbenchHeaderButtonControl;
  terminalControl: SessionWorkbenchHeaderButtonControl;
}): React.JSX.Element {
  const isMobileHeaderLayout = useIsMobileHeaderLayout();
  const desktopPortAccessControl = isMobileHeaderLayout ? null : input.portAccessControl;
  const mobilePortAccessControl =
    isMobileHeaderLayout && input.mobilePortAccessControl !== undefined
      ? input.mobilePortAccessControl
      : null;
  const mobileConversationNavigatorControl =
    isMobileHeaderLayout && input.mobileConversationNavigatorControl !== undefined
      ? input.mobileConversationNavigatorControl
      : null;
  const [isMoreActionsOpen, setMoreActionsOpen] = useState(false);
  const repositoryControl = input.repositoryControl;
  const selectedRepositoryLabel =
    repositoryControl === undefined
      ? null
      : (repositoryControl.options.find(
          (option) => option.value === repositoryControl.selectedValue,
        )?.label ?? null);
  const repositoryIndicator =
    repositoryControl === undefined ? null : repositoryControl.isRefreshing === true ? (
      <Spinner aria-label="Refreshing repositories" className="size-3.5 text-muted-foreground" />
    ) : undefined;
  const compactRepositoryLabel =
    selectedRepositoryLabel === null ? null : toCompactRepositoryLabel(selectedRepositoryLabel);

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {input.status.kind === "error" ? (
        <Badge aria-label={input.status.label} title={input.status.label} variant="destructive">
          {input.status.label}
        </Badge>
      ) : (
        <Badge
          aria-label={input.status.label}
          className={input.status.className}
          role="status"
          title={input.status.label}
          variant={input.status.variant ?? "outline"}
        >
          {input.status.label}
        </Badge>
      )}
      {repositoryControl === undefined ? null : (
        <>
          <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />
          <Select
            disabled={repositoryControl.disabled}
            onOpenChange={repositoryControl.onOpenChange}
            onValueChange={(nextValue) => {
              if (nextValue === null) {
                return;
              }

              repositoryControl.onValueChange(nextValue);
            }}
            value={resolveSelectableValue({
              selectedValue: repositoryControl.selectedValue,
              optionValues: repositoryControl.options.map((option) => option.value),
            })}
          >
            <SelectTrigger
              aria-label={repositoryControl.ariaLabel}
              className="h-9 w-24 min-w-0 border-border bg-transparent px-2 text-sm shadow-none hover:bg-muted/60 sm:h-8 sm:w-48 sm:px-2.5"
              indicator={repositoryIndicator}
              title={repositoryControl.title ?? repositoryControl.ariaLabel}
            >
              <GitBranchIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground sm:hidden"
              />
              <SelectValue className="min-w-0 truncate" placeholder="Primary repository">
                <span className="sm:hidden">{compactRepositoryLabel ?? "Repo"}</span>
                <span className="hidden sm:inline">
                  {selectedRepositoryLabel ?? "Primary repository"}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {repositoryControl.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
              {repositoryControl.errorMessage === undefined ? null : (
                <>
                  <SelectSeparator />
                  <Notice
                    variant="alert"
                    appearance="subtle"
                    className="rounded-none border-0 bg-transparent px-3 py-2 text-xs"
                    role="note"
                  >
                    {repositoryControl.errorMessage}
                  </Notice>
                </>
              )}
            </SelectContent>
          </Select>
        </>
      )}
      <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />
      <div className="hidden items-center gap-2 sm:flex">
        <Button
          aria-label={input.cliControl.ariaLabel}
          aria-pressed={input.cliControl.pressed}
          className={input.cliControl.className}
          disabled={input.cliControl.disabled}
          onClick={input.cliControl.onClick}
          size="sm"
          title={input.cliControl.title}
          type="button"
          variant="ghost"
        >
          <span className="text-sm font-medium">TUI</span>
        </Button>
        {input.conversationControl === undefined ? null : (
          <HeaderIconButton control={input.conversationControl}>
            <ListBulletsIcon className="size-4" />
          </HeaderIconButton>
        )}
        <HeaderIconButton control={input.diffControl}>
          <GitDiffIcon className="size-4" />
        </HeaderIconButton>
        {desktopPortAccessControl}
        <HeaderIconButton control={input.terminalControl}>
          <TerminalIcon className="size-4" />
        </HeaderIconButton>
      </div>
      <DropdownMenu onOpenChange={setMoreActionsOpen} open={isMoreActionsOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="Open session tools"
              className="sm:hidden"
              size="icon-sm"
              title="Session tools"
              type="button"
              variant="ghost"
            />
          }
        >
          <DotsThreeIcon aria-hidden className="size-5" weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 sm:hidden" sideOffset={8}>
          <DropdownMenuGroup>
            <HeaderMenuItem control={input.cliControl} label="TUI">
              <IntegrationLogo alt="" className="size-4" logoKey="openai" />
            </HeaderMenuItem>
            {mobileConversationNavigatorControl === null &&
            input.conversationControl !== undefined ? (
              <HeaderMenuItem control={input.conversationControl} label="Conversations">
                <ListBulletsIcon className="size-4" />
              </HeaderMenuItem>
            ) : null}
            {mobileConversationNavigatorControl === null ? null : (
              <DropdownMenuItem
                aria-label="Conversations"
                disabled={mobileConversationNavigatorControl.disabled}
                onClick={() => {
                  setMoreActionsOpen(false);
                  mobileConversationNavigatorControl.onOpen();
                }}
                title={mobileConversationNavigatorControl.title}
              >
                <ListBulletsIcon className="size-4" />
                <span className="truncate">Conversations</span>
              </DropdownMenuItem>
            )}
            <HeaderMenuItem control={input.diffControl} label="Changes">
              <GitDiffIcon className="size-4" />
            </HeaderMenuItem>
            <HeaderMenuItem control={input.terminalControl} label="Terminal">
              <TerminalIcon className="size-4" />
            </HeaderMenuItem>
          </DropdownMenuGroup>
          {mobilePortAccessControl === null ? null : (
            <DropdownMenuItem
              aria-label="Processes"
              disabled={mobilePortAccessControl.disabled}
              onClick={() => {
                setMoreActionsOpen(false);
                mobilePortAccessControl.onOpen();
              }}
              title={mobilePortAccessControl.title}
            >
              <CpuIcon className="size-4" />
              <span className="truncate">Processes</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {mobileConversationNavigatorControl?.surface}
      {mobilePortAccessControl?.surface}
    </div>
  );
}

function useIsMobileHeaderLayout(): boolean {
  return useIsBelowBreakpoint(CssBreakpointVariables.SM);
}

function HeaderIconButton(input: {
  children: React.ReactNode;
  control: SessionWorkbenchHeaderButtonControl;
}): React.JSX.Element {
  return (
    <Button
      aria-label={input.control.ariaLabel}
      aria-pressed={input.control.pressed}
      className={input.control.className}
      disabled={input.control.disabled}
      onClick={input.control.onClick}
      size="icon-sm"
      title={input.control.title}
      type="button"
      variant="ghost"
    >
      {input.children}
    </Button>
  );
}

function HeaderMenuItem(input: {
  children?: React.ReactNode;
  control: SessionWorkbenchHeaderButtonControl;
  label: string;
}): React.JSX.Element {
  return (
    <DropdownMenuItem
      aria-label={input.label}
      disabled={input.control.disabled}
      onClick={input.control.onClick}
      title={input.control.title}
    >
      {input.children}
      <span className="truncate">{input.label}</span>
    </DropdownMenuItem>
  );
}

function toCompactRepositoryLabel(label: string): string {
  const pathParts = label.split("/").filter((part) => part.length > 0);
  return pathParts.at(-1) ?? label;
}
