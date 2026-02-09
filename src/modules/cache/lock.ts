import { getRedisClient, getRedisHealthStatus } from '../../libs/redis';
import { logger } from '../../libs/logger';
import { CacheKeyBuilder } from '../../libs/cache-keys';
import { config } from '../../config';

/**
 * 分布式锁模块
 * 
 * 使用Redis实现分布式锁，防止多进程/多服务器并发处理同一数据
 * 
 * 实现特点：
 * - 使用Redis的SET NX EX命令，保证原子性
 * - 自动过期机制，防止死锁
 * - 非阻塞设计，获取失败立即返回
 * - Redis故障时使用本地内存锁作为降级方案
 * 
 * 适用场景：
 * - 防止同一期号被多个进程同时写入
 * - 确保分布式环境下的操作互斥性
 * - 保护临界区代码
 * 
 * 使用模式：
 * ```typescript
 * if (await acquireLock(id)) {
 *   try {
 *     // 执行需要互斥的操作
 *   } finally {
 *     await releaseLock(id);
 *   }
 * }
 * ```
 */

/** 锁的过期时间（秒） - 防止死锁 */
const LOCK_TTL = config.cache.lockTTL;

/** 本地内存锁（Redis故障时的降级方案） */
const localLocks = new Map<string, number>();
const LOCAL_LOCK_TTL = LOCK_TTL * 1000; // 转换为毫秒

/**
 * 清理过期的本地锁
 */
function cleanLocalLocks(): void {
  const now = Date.now();
  const locksToDelete: string[] = [];
  
  for (const [issue, timestamp] of localLocks.entries()) {
    if (now - timestamp > LOCAL_LOCK_TTL) {
      locksToDelete.push(issue);
    }
  }
  
  locksToDelete.forEach(issue => localLocks.delete(issue));
}

/**
 * 尝试获取本地锁
 */
function acquireLocalLock(issue: string): boolean {
  cleanLocalLocks();
  
  const now = Date.now();
  const existingLock = localLocks.get(issue);
  
  // 检查锁是否已存在且未过期
  if (existingLock && now - existingLock < LOCAL_LOCK_TTL) {
    return false;
  }
  
  // 获取锁
  localLocks.set(issue, now);
  return true;
}

/**
 * 释放本地锁
 */
function releaseLocalLock(issue: string): void {
  localLocks.delete(issue);
}

/**
 * 获取分布式锁
 * 
 * 尝试获取指定期号的分布式锁
 * 使用Redis的SET NX EX命令实现，确保操作的原子性
 * 
 * 锁会在LOCK_TTL秒后自动过期，防止死锁
 * 这是一个非阻塞操作，获取失败会立即返回false
 * 
 * @param issue 期号（用作锁的标识）
 * @returns 成功获取锁返回true，锁已被占用或出错返回false
 * 
 * @example
 * ```typescript
 * const lockAcquired = await acquireLock('2025001');
 * if (lockAcquired) {
 *   try {
 *     // 执行需要互斥保护的操作
 *     await processData();
 *   } finally {
 *     await releaseLock('2025001');
 *   }
 * } else {
 *   console.log('其他进程正在处理该期号');
 * }
 * ```
 */
export async function acquireLock(issue: string): Promise<boolean> {
  // 降级方案：如果Redis不健康，使用本地内存锁
  if (!getRedisHealthStatus()) {
    const acquired = acquireLocalLock(issue);
    if (acquired) {
      logger.debug({ issue, type: 'local' }, '获取本地锁成功');
    }
    return acquired;
  }

  try {
    const lockKey = CacheKeyBuilder.lockKey(issue);
    const client = getRedisClient();
    
    const result = await client.set(lockKey, 'locked', 'EX', LOCK_TTL, 'NX');
    
    const acquired = result === 'OK';
    
    if (acquired) {
      logger.debug({ issue, ttl: LOCK_TTL }, '获取锁成功');
      return true;
    }
    
    logger.debug({ issue }, '锁已被占用');
    return false;
  } catch (error: any) {
    // Redis操作失败，降级到本地锁
    logger.debug({ 
      issue,
      errorMessage: error?.message || String(error),
      errorCode: error?.code,
      errorName: error?.name
    }, '获取锁失败，使用本地锁');
    
    const acquired = acquireLocalLock(issue);
    if (acquired) {
      logger.debug({ issue, type: 'local' }, '获取本地锁成功');
    }
    return acquired;
  }
}

/**
 * 释放锁
 * 
 * 删除Redis中的锁记录，允许其他进程获取锁
 * 
 * 注意：
 * - 应该在finally块中调用，确保锁一定会被释放
 * - 即使Redis操作失败，锁也会在TTL后自动过期
 * 
 * @param issue 期号（用作锁的标识）
 * 
 * @example
 * ```typescript
 * try {
 *   await processData();
 * } finally {
 *   await releaseLock('2025001');
 * }
 * ```
 */
export async function releaseLock(issue: string): Promise<void> {
  // 始终释放本地锁（如果存在）
  releaseLocalLock(issue);
  
  // 如果Redis不健康，只释放本地锁
  if (!getRedisHealthStatus()) {
    return;
  }

  try {
    const lockKey = CacheKeyBuilder.lockKey(issue);
    const client = getRedisClient();
    
    await client.del(lockKey);
    
    logger.debug({ issue }, '释放锁成功');
  } catch (error: any) {
    // Redis失败不影响流程，本地锁已经释放
    logger.debug({ 
      issue,
      errorMessage: error?.message || String(error),
      errorCode: error?.code,
      errorName: error?.name
    }, '释放锁失败（已释放本地锁）');
  }
}








