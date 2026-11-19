/** 对外错误码使用独立枚举，序列化值保持稳定。 */
export enum CodeTabErrorCode {
  InvalidOptions = "INVALID_OPTIONS",
  InvalidOperation = "INVALID_OPERATION",
  ContainerInUse = "CONTAINER_IN_USE",
  ReadOnly = "READ_ONLY",
  Busy = "BUSY",
  Disposed = "DISPOSED",
  RevisionMismatch = "REVISION_MISMATCH",
  CommitFailed = "COMMIT_FAILED",
  RenderFailed = "RENDER_FAILED",
}

export class CodeTabError extends Error {
  constructor(
    public readonly code: CodeTabErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CodeTabError";
  }
}
