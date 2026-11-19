/** 对外错误码使用独立枚举，序列化值保持稳定。 */
export enum CompletionErrorCode {
  InvalidContext = "INVALID_CONTEXT",
  InvalidRule = "INVALID_RULE",
  DuplicateId = "DUPLICATE_ID",
  NotFound = "NOT_FOUND",
  Cancelled = "CANCELLED",
  Stale = "STALE",
  Disposed = "DISPOSED",
}

export class CompletionError extends Error {
  constructor(
    public readonly code: CompletionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CompletionError";
  }
}
