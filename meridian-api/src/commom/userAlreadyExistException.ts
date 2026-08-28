// Compatibility shim: legacy misspelled import path used by some spec files.
import { HttpException, HttpStatus } from '@nestjs/common';

export class UserAlreadyExistException extends HttpException {
  constructor(fieldName: string, fieldValue: string) {
    super(`${fieldValue} already exists`, HttpStatus.CONFLICT);
  }
}
