import { retryAsync, RetryOptions } from '../helpers/retry';
import { logger } from '../libs/logger';
import { writeDB } from './client';
import { config } from '../config';

/**
 * 数据库操作包装器
 * 提供带重试、超时保护和错误处理的数据库操作方法
 */

/**
 * 默认重试配置
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: config.retry.maxAttempts,
  initialDelay: config.retry.initialDelay,
  maxDelay: config.retry.maxDelay
};

/**
 * 带重试的数据库操作包装器
 * 
 * @param operation 数据库操作函数
 * @param options 重试配置
 * @returns 操作结果
 * 
 * @example
 * ```typescript
 * const users = await withRetry(
 *   async () => await prisma.user.findMany(),
 *   { operation: '查询用户列表' }
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const mergedOptions: RetryOptions = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options
  };
  
  return retryAsync(operation, mergedOptions);
}

/**
 * 安全的数据库查询操作
 * 失败时返回默认值而非抛出异常
 * 
 * @param operation 查询操作
 * @param defaultValue 失败时的默认返回值
 * @param options 重试配置
 * @returns 查询结果或默认值
 * 
 * @example
 * ```typescript
 * const users = await safeQuery(
 *   async () => await prisma.user.findMany(),
 *   [],
 *   { operation: '查询用户列表' }
 * );
 * ```
 */
export async function safeQuery<T>(
  operation: () => Promise<T>,
  defaultValue: T,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  try {
    return await withRetry(operation, options);
  } catch (error: any) {
    logger.error(
      { 
        error: error.message, 
        code: error.code,
        operation: options.operation || '数据库查询'
      },
      '查询失败，返回默认值'
    );
    return defaultValue;
  }
}

/**
 * 安全的数据库写入操作
 * 失败时记录错误但不抛出异常
 * 
 * @param operation 写入操作
 * @param options 重试配置
 * @returns 是否成功
 * 
 * @example
 * ```typescript
 * const success = await safeWrite(
 *   async () => await prisma.user.create({ data: {...} }),
 *   { operation: '创建用户' }
 * );
 * ```
 */
export async function safeWrite(
  operation: () => Promise<any>,
  options: Partial<RetryOptions> = {}
): Promise<boolean> {
  try {
    await withRetry(operation, options);
    return true;
  } catch (error: any) {
    logger.error(
      { 
        error: error.message, 
        code: error.code,
        operation: options.operation || '数据库写入'
      },
      '写入失败'
    );
    return false;
  }
}

/**
 * 带超时的数据库操作
 * 
 * @param operation 数据库操作
 * @param timeoutMs 超时时间（毫秒）
 * @param operationName 操作名称
 * @returns 操作结果
 * 
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   async () => await prisma.user.findMany(),
 *   5000,
 *   '查询用户列表'
 * );
 * ```
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  operationName: string = '数据库操作'
): Promise<T> {
  return Promise.race([
    operation(),
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operationName}超时（${timeoutMs}ms）`));
      }, timeoutMs);
    })
  ]);
}

/**
 * 批量操作包装器
 * 将数组分批处理，避免一次性操作过多数据
 * 
 * @param items 要处理的项目数组
 * @param batchSize 每批大小
 * @param operation 对每批执行的操作
 * @param options 重试配置
 * @returns 所有批次的结果
 * 
 * @example
 * ```typescript
 * await batchOperation(
 *   users,
 *   100,
 *   async (batch) => await prisma.user.createMany({ data: batch }),
 *   { operation: '批量创建用户' }
 * );
 * ```
 */
export async function batchOperation<T, R>(
  items: T[],
  batchSize: number,
  operation: (batch: T[]) => Promise<R>,
  options: Partial<RetryOptions> = {}
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const result = await withRetry(
      () => operation(batch),
      {
        ...options,
        operation: `${options.operation || '批量操作'} (批次 ${Math.floor(i / batchSize) + 1})`
      }
    );
    results.push(result);
  }
  
  return results;
}

/**
 * 安全的 upsert 操作
 * 如果记录存在则更新，不存在则创建
 * 对于唯一键冲突会优雅处理
 * 
 * @param operation upsert 操作函数
 * @param options 重试配置
 * @returns 操作结果
 * 
 * @example
 * ```typescript
 * const result = await safeUpsert(
 *   async () => await prisma.lottery.upsert({
 *     where: { qihao: '123' },
 *     create: { ... },
 *     update: { ... }
 *   }),
 *   { operation: 'upsert开奖数据' }
 * );
 * ```
 */
export async function safeUpsert<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  try {
    return await withRetry(operation, options);
  } catch (error: any) {
    // P2002 唯一键冲突在 upsert 中理论上不应该发生
    // 但如果发生了，说明可能有并发问题，记录警告
    if (error.code === 'P2002') {
      logger.warn(
        { 
          error: error.message, 
          code: error.code,
          operation: options.operation || 'upsert操作'
        },
        'Upsert 操作遇到唯一键冲突（可能存在并发问题）'
      );
      throw error;
    }
    throw error;
  }
}

/**
 * 带降级的查询包装器
 * 数据库失败时自动读取本地JSON备份
 * 
 * @param dbOperation 数据库查询操作
 * @param fallbackOperation 降级操作（读取本地备份）
 * @param options 重试配置
 * @returns 查询结果
 * 
 * @example
 * ```typescript
 * const records = await withFallback(
 *   async () => await prisma.lottery.findMany({...}),
 *   async () => await readFromLocalJson(10),
 *   { operation: '查询开奖数据' }
 * );
 * ```
 */
export async function withFallback<T>(
  dbOperation: () => Promise<T>,
  fallbackOperation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  try {
    return await withRetry(dbOperation, options);
  } catch (error: any) {
    // 连接错误时使用降级方案
    if (error.code === 'P1001' || error.code === 'P2024') {
      logger.warn(
        { 
          error: error.message, 
          code: error.code,
          operation: options.operation 
        },
        '数据库连接失败，使用本地JSON降级'
      );
      
      return await fallbackOperation();
    }
    throw error;
  }
}

/**
 * 批量更新统计数据（使用CASE语句）
 * 
 * 使用参数化查询防止SQL注入
 * 
 * @param tableName 表名
 * @param updates 更新数据数组
 * @param typeColumn 类型字段名
 * @param countColumn 计数字段名
 */
export async function batchUpdateStats(
  tableName: string,
  updates: Array<{ type: string; count: number }>,
  typeColumn: string = 'omission_type',
  countColumn: string = 'omission_count'
): Promise<void> {
  if (updates.length === 0) return;
  
  // 使用Prisma的参数化查询
  const caseStatements = updates
    .map(() => `WHEN ? THEN ?`)
    .join(' ');
  
  const placeholders = updates.map(() => '?').join(',');
  
  const sql = `
    UPDATE ${tableName}
    SET ${countColumn} = CASE ${typeColumn} ${caseStatements} END,
        updated_at = NOW()
    WHERE ${typeColumn} IN (${placeholders})
  `;
  
  // 构建参数数组: [type1, count1, type2, count2, ..., type1, type2, ...]
  const caseParams: any[] = [];
  updates.forEach(u => {
    caseParams.push(u.type, u.count);
  });
  const whereParams = updates.map(u => u.type);
  
  const allParams = [...caseParams, ...whereParams];
  
  await withRetry(
    async () => await writeDB.$executeRawUnsafe(sql, ...allParams),
    { operation: `批量更新${tableName}`, maxAttempts: 2 }
  );
}

/**
 * 批量插入或更新统计数据（使用ON DUPLICATE KEY UPDATE）
 * 
 * @param tableName 表名
 * @param keyColumn 主键列名
 * @param keyValue 主键值
 * @param types 统计类型列表
 * @param typeColumn 类型字段名
 * @param countColumn 计数字段名
 */
export async function batchUpsertStats(
  tableName: string,
  keyColumn: string,
  keyValue: string,
  types: string[],
  typeColumn: string = 'omission_type',
  countColumn: string = 'omission_count'
): Promise<void> {
  if (types.length === 0) return;
  
  const placeholders = types.map(() => '(?, ?, 1, NOW())').join(',');
  const params: any[] = [];
  types.forEach(type => {
    params.push(keyValue, type);
  });
  
  const sql = `
    INSERT INTO ${tableName} (${keyColumn}, ${typeColumn}, ${countColumn}, updated_at)
    VALUES ${placeholders}
    ON DUPLICATE KEY UPDATE
      ${countColumn} = ${countColumn} + 1,
      updated_at = NOW()
  `;
  
  await withRetry(
    async () => await writeDB.$executeRawUnsafe(sql, ...params),
    { operation: `批量upsert${tableName}`, maxAttempts: 2 }
  );
}

