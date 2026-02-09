import { logger } from '../libs/logger';

/**
 * 重试配置选项（公网访问优化：默认5次重试，初始延迟2秒）
 */
export interface RetryOptions {
  /** 最大重试次数 */
  maxAttempts?: number;
  /** 初始延迟时间（毫秒） */
  initialDelay?: number;
  /** 最大延迟时间（毫秒） */
  maxDelay?: number;
  /** 操作名称（用于日志） */
  operation?: string;
  /** 是否应该重试的判断函数 */
  shouldRetry?: (error: any) => boolean;
}

/**
 * 默认的重试判断函数
 * 对于数据库连接相关的错误进行重试（公网高并发优化）
 */
function defaultShouldRetry(error: any): boolean {
  // ===== 不应重试的错误（业务逻辑错误） =====
  if (error.code === 'P2002') return false; // Prisma 唯一约束冲突
  if (error.code === 'P2003') return false; // Prisma 外键约束冲突
  if (error.code === 'P2004') return false; // Prisma 约束失败
  if (error.code === 'P2014') return false; // Prisma 关系冲突
  if (error.code === 'P2025') return false; // Prisma 记录不存在
  
  // HTTP 4xx 客户端错误（除了429）不应重试
  if (error.response?.status >= 400 && error.response?.status < 500) {
    if (error.response?.status === 429) return true; // 速率限制，应该重试
    return false; // 其他4xx错误不重试
  }
  
  // ===== 应该重试的错误（临时性/网络错误） =====
  
  // HTTP 5xx 服务器错误（应该重试）
  if (error.response?.status >= 500 && error.response?.status < 600) return true;
  
  // Axios 特定错误
  if (error.code === 'ECONNABORTED') return true;  // 连接中止
  if (error.code === 'ERR_CANCELED') return true;  // 请求取消
  
  // Prisma 连接相关错误
  if (error.code === 'P2024') return true; // 连接池超时
  if (error.code === 'P1001') return true; // 无法连接数据库
  if (error.code === 'P1002') return true; // 连接超时
  if (error.code === 'P1008') return true; // 操作超时
  if (error.code === 'P1017') return true; // 服务器关闭连接
  
  // 网络错误（公网常见）
  if (error.code === 'ECONNREFUSED') return true;  // 连接被拒绝
  if (error.code === 'ETIMEDOUT') return true;     // 超时
  if (error.code === 'ENOTFOUND') return true;     // DNS解析失败
  if (error.code === 'ECONNRESET') return true;    // 连接重置
  if (error.code === 'EPIPE') return true;         // 管道破裂
  if (error.code === 'ENETUNREACH') return true;   // 网络不可达
  if (error.code === 'EHOSTUNREACH') return true;  // 主机不可达
  if (error.code === 'EAI_AGAIN') return true;     // DNS临时失败
  
  // MySQL 服务器临时性错误
  if (error.errno === 1205) return true; // Lock wait timeout（锁等待超时）
  if (error.errno === 1213) return true; // Deadlock（死锁）
  if (error.errno === 1040) return true; // Too many connections（连接数过多）
  if (error.errno === 2002) return true; // Can't connect to server（无法连接）
  if (error.errno === 2003) return true; // Can't connect to server on socket（套接字连接失败）
  if (error.errno === 2006) return true; // MySQL server has gone away（服务器断开）
  if (error.errno === 2013) return true; // Lost connection during query（查询中断）
  
  // 错误消息匹配（兜底检查）
  const errorMessage = error.message || '';
  if (errorMessage.includes('Connection') && errorMessage.includes('timeout')) return true;
  if (errorMessage.includes('Connection') && errorMessage.includes('lost')) return true;
  if (errorMessage.includes('Connection') && errorMessage.includes('closed')) return true;
  if (errorMessage.includes('ECONNRESET')) return true;
  if (errorMessage.includes('socket hang up')) return true;
  if (errorMessage.includes('aborted')) return true; // axios aborted 错误
  
  return false;
}

/**
 * 计算指数退避延迟时间（带抖动）
 * 抖动可以避免多个请求同时重试造成的雪崩效应
 */
function calculateDelay(attempt: number, initialDelay: number, maxDelay: number): number {
  // 指数退避：initialDelay * 2^(attempt-1)
  const exponentialDelay = initialDelay * Math.pow(2, attempt - 1);
  
  // 添加随机抖动（0-20%）避免雪崩
  const jitter = exponentialDelay * Math.random() * 0.2;
  
  const delay = exponentialDelay + jitter;
  return Math.min(delay, maxDelay);
}

/**
 * 延迟执行
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带重试的异步函数执行器
 * 
 * @param fn 要执行的异步函数
 * @param options 重试配置选项
 * @returns 函数执行结果
 * 
 * @example
 * ```typescript
 * const result = await retryAsync(
 *   async () => await db.query('SELECT * FROM users'),
 *   { maxAttempts: 3, operation: '查询用户列表' }
 * );
 * ```
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 5,
    initialDelay = 2000,
    maxDelay = 10000,
    operation = '操作',
    shouldRetry = defaultShouldRetry
  } = options;

  let lastError: any;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // 检查是否应该重试
      if (!shouldRetry(error)) {
        logger.debug(
          { error: error.message, code: error.code, operation },
          '错误不可重试，直接抛出'
        );
        throw error;
      }
      
      // 如果是最后一次尝试，直接抛出错误
      if (attempt === maxAttempts) {
        logger.error(
          { 
            error: error.message, 
            code: error.code, 
            attempts: attempt, 
            operation 
          },
          `${operation}失败，已达到最大重试次数`
        );
        throw error;
      }
      
      // 计算延迟时间
      const delay = calculateDelay(attempt, initialDelay, maxDelay);
      
      logger.warn(
        { 
          error: error.message, 
          code: error.code, 
          attempt, 
          maxAttempts, 
          delayMs: delay,
          operation 
        },
        `${operation}失败，${delay}ms后进行第${attempt + 1}次尝试`
      );
      
      // 等待后重试
      await sleep(delay);
    }
  }
  
  // 理论上不会到达这里，但为了类型安全
  throw lastError;
}

/**
 * 创建带重试的函数包装器
 * 
 * @param fn 要包装的函数
 * @param options 重试配置选项
 * @returns 包装后的函数
 * 
 * @example
 * ```typescript
 * const safeQuery = withRetry(
 *   (id: number) => db.user.findUnique({ where: { id } }),
 *   { maxAttempts: 3, operation: '查询用户' }
 * );
 * const user = await safeQuery(123);
 * ```
 */
export function withRetry<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    return retryAsync(() => fn(...args), options);
  };
}

