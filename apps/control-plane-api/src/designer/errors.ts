import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";

import { DesignerBadRequestCodes, DesignerNotFoundCodes } from "./constants.js";

export { DesignerBadRequestCodes, DesignerNotFoundCodes };

export type DesignerBadRequestCode =
  (typeof DesignerBadRequestCodes)[keyof typeof DesignerBadRequestCodes];

export class DesignerBadRequestError extends BadRequestError {
  code: DesignerBadRequestCode;

  constructor(code: DesignerBadRequestCode, message: string) {
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
