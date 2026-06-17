import { BadRequestError, ConflictError, NotFoundError } from "@mistle/http/errors.js";

import {
  DesignerBadRequestCodes,
  DesignerConflictCodes,
  DesignerNotFoundCodes,
} from "./constants.js";

export { DesignerBadRequestCodes, DesignerConflictCodes, DesignerNotFoundCodes };

export type DesignerBadRequestCode =
  (typeof DesignerBadRequestCodes)[keyof typeof DesignerBadRequestCodes];

export class DesignerBadRequestError extends BadRequestError {
  code: DesignerBadRequestCode;

  constructor(code: DesignerBadRequestCode, message: string) {
    super(code, message);
    this.code = code;
  }
}

export type DesignerConflictCode =
  (typeof DesignerConflictCodes)[keyof typeof DesignerConflictCodes];

export class DesignerConflictError extends ConflictError {
  code: DesignerConflictCode;

  constructor(code: DesignerConflictCode, message: string) {
    super(code, message);
    this.code = code;
  }
}

export type DesignerNotFoundCode =
  (typeof DesignerNotFoundCodes)[keyof typeof DesignerNotFoundCodes];

export class DesignerNotFoundError extends NotFoundError {
  code: DesignerNotFoundCode;

  constructor(code: DesignerNotFoundCode, message: string) {
    super(code, message);
    this.code = code;
  }
}
