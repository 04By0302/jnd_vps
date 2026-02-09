/**
 * 错误码定义
 */

export enum ErrorCode {
  // 数据校验错误 (1000-1099)
  VALIDATION_FAILED = 1000,
  INVALID_SUM = 1001,
  INVALID_ISSUE = 1002,
  INVALID_TIME = 1003,
  ISSUE_NOT_INCREASING = 1004,

  // 数据库错误 (2000-2099)
  DB_CONNECTION_FAILED = 2000,
  DB_WRITE_FAILED = 2001,
  DB_READ_FAILED = 2002,
  DB_DUPLICATE_KEY = 2003,

  // Redis错误 (3000-3099)
  REDIS_CONNECTION_FAILED = 3000,
  REDIS_LOCK_FAILED = 3001,
  REDIS_OPERATION_FAILED = 3002,

  // 数据源错误 (4000-4099)
  FETCH_FAILED = 4000,
  FETCH_TIMEOUT = 4001,
  PARSE_FAILED = 4002,
  INVALID_RESPONSE = 4003,

  // 业务逻辑错误 (5000-5099)
  ALREADY_PROCESSED = 5000,
  LOCK_ALREADY_HELD = 5001,
  DATA_TOO_OLD = 5002,

  // 系统错误 (9000-9099)
  UNKNOWN_ERROR = 9000,
  SYSTEM_ERROR = 9001
}

export class LotteryError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'LotteryError';
  }
}






