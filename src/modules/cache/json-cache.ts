import { getRedisClient } from '../../libs/redis';
import { CacheKeys } from '../../types';
import { logger } from '../../libs/logger';

/**
 * JSON缓存模块
 * 
 * 提供JSON数据的Redis缓存功能
 * 主要用于缓存计算结果、查询结果等，减少数据库访问和重复计算
 * 
 * 功能特点：
 * - 自动JSON序列化/反序列化
 * - 支持可选的过期时间
 * - 容错设计：操作失败不抛出异常
 * 
 * 适用场景：
 * - 频繁访问的查询结果
 * - 计算密集型操作的结果
 * - 需要跨进程共享的临时数据
 */

/**
 * 缓存JSON结果
 * 
 * 将JavaScript对象序列化为JSON字符串并存储到Redis
 * 可以指定过期时间，适合临时性数据
 * 
 * @param key 缓存键（使用CacheKeys枚举）
 * @param data 要缓存的数据（可以是对象、数组等任何可JSON序列化的数据）
 * @param ttl 过期时间（秒），不设置则永久保存
 * 
 * @example
 * ```typescript
 * // 缓存10分钟
 * await cacheJsonResult(CacheKeys.DAILY_STATS, statsData, 600);
 * 
 * // 永久缓存
 * await cacheJsonResult(CacheKeys.CONFIG, configData);
 * ```
 */
export async function cacheJsonResult(key: CacheKeys, data: any, ttl?: number): Promise<void> {
  try {
    const redis = getRedisClient();
    const jsonStr = serializeData(data);
    
    await saveToRedis(redis, key, jsonStr, ttl);
    
    logger.debug({ key, ttl, dataSize: jsonStr.length }, 'JSON结果已缓存');
  } catch (error) {
    logger.error({ error, key }, '缓存JSON结果失败');
  }
}

/**
 * 获取缓存的JSON
 * 
 * 从Redis读取JSON字符串并反序列化为JavaScript对象
 * 
 * @param key 缓存键（使用CacheKeys枚举）
 * @returns 反序列化后的数据，如果不存在或出错返回null
 * 
 * @example
 * ```typescript
 * const stats = await getCachedJson(CacheKeys.DAILY_STATS);
 * if (stats) {
 *   console.log('使用缓存数据:', stats);
 * } else {
 *   console.log('缓存未命中，需要重新计算');
 * }
 * ```
 */
export async function getCachedJson(key: CacheKeys): Promise<any | null> {
  try {
    const redis = getRedisClient();
    const jsonStr = await redis.get(key);
    
    if (!jsonStr) {
      logger.debug({ key }, '缓存未命中');
      return null;
    }
    
    return deserializeData(jsonStr);
  } catch (error) {
    logger.error({ error, key }, '获取缓存JSON失败');
    return null;
  }
}

/**
 * 清除指定缓存
 * 
 * 从Redis中删除指定的缓存键
 * 用于缓存失效、数据更新等场景
 * 
 * @param key 缓存键（使用CacheKeys枚举）
 * 
 * @example
 * ```typescript
 * // 数据更新后清除缓存
 * await clearCache(CacheKeys.DAILY_STATS);
 * ```
 */
export async function clearCache(key: CacheKeys): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(key);
    logger.debug({ key }, '缓存已清除');
  } catch (error) {
    logger.error({ error, key }, '清除缓存失败');
  }
}

/**
 * 序列化数据为JSON字符串
 * @param data 要序列化的数据
 * @returns JSON字符串
 */
function serializeData(data: any): string {
  return JSON.stringify(data);
}

/**
 * 反序列化JSON字符串
 * @param jsonStr JSON字符串
 * @returns 反序列化后的对象
 */
function deserializeData(jsonStr: string): any {
  return JSON.parse(jsonStr);
}

/**
 * 保存数据到Redis
 * @param redis Redis客户端
 * @param key 键
 * @param value 值
 * @param ttl 过期时间（秒）
 */
async function saveToRedis(redis: any, key: string, value: string, ttl?: number): Promise<void> {
  if (ttl) {
    await redis.setex(key, ttl, value);
  } else {
    await redis.set(key, value);
  }
}






