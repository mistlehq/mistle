export function noop(): void {}

export function noopRespondToServerRequest(_requestId: string | number, _result: unknown): void {}

export function noopComposerTextChange(_value: string): void {}

export function noopModelChange(_value: string): void {}

export function noopPendingImageFilesAdded(_files: readonly File[]): void {}

export function noopReasoningEffortChange(_value: string): void {}

export function noopRemovePendingAttachment(_attachmentId: string): void {}
