// Errors carry the CLI exit code (SPEC 8) and a stable `reason` the GUI can switch on.

export const EXIT = { OK: 0, USAGE: 1, NOT_PROCESSED: 2, NO_DATA: 3, VERIFY: 4 };

export class SpoilerError extends Error {
  constructor(exitCode, reason, message, extra = {}) {
    super(message);
    this.name = 'SpoilerError';
    this.exitCode = exitCode;
    this.reason = reason;
    Object.assign(this, extra);
  }
}

export const usage = (reason, message, extra) => new SpoilerError(EXIT.USAGE, reason, message, extra);
export const verify = (reason, message, extra) => new SpoilerError(EXIT.VERIFY, reason, message, extra);
