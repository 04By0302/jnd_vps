import { getRedisClient, getRedisHealthStatus } from '../../libs/redis';
import { logger } from '../../libs/logger';
import { CacheKeyBuilder } from '../../libs/cache-keys';
import { config } from '../../config';
import fs from 'fs';
import path from 'path';

/**
 * 数据去重模块（增强版）
 * 
 * 使用Redis实现分布式去重机制，防止同一期号的数据被重复处理
 * 主要功能：
 * - 检查期号是否已处理
 * - 标记期号已处理（带过期时间）
 * - 跟踪最后处理的期号（用于期号递增校验）
 * 
 * 设计特点：
 * - 使用Redis的原子操作保证并发安全
 * - 已处理标记自动过期，避免内存积累
 * - 三层降级方案：Redis -> 本地内存 -> 本地文件
 * - 自动持久化本地缓存，重启后恢复
 * 
 * 降级策略：
 * 1. 正常：使用Redis（分布式）
 * 2. Redis故障：使用本地内存（单机）
 * 3. 重启恢复：从本地文件加载（持久化）
 */

/** 已处理标记的过期时间（秒） */
const SEEN_TTL = config.cache.seenTTL;

/** 本地内存缓存（Redis故障时的降级方案） */
const localProcessedCache = new Map<string, number>();
const LOCAL_CACHE_TTL = 3600000; // 1小时（毫秒）- 增加到1小时
const MAX_LOCAL_CACHE_SIZE = 5000; // 增加到5000个期号
const LOCAL_CACHE_FILE = path.join(config.output.dir, '.cache', 'processed-issues.json');

/** 最后期号的本地缓存 */
let lastIssueLocal: string | null = null;

/**
 * 加载本地缓存文件（启动时恢复）
 */
function loadLocalCache(): void {
  try {
    if (fs.existsSync(LOCAL_CACHE_FILE)) {
      const data = fs.readFileSync(LOCAL_CACHE_FILE, 'utf-8');
      const cache = JSON.parse(data);
      
      const now = Date.now();
      let loaded = 0;
      
      // 只加载未过期的数据
      for (const [issue, timestamp] of Object.entries(cache.processed || {})) {
        if (now - (timestamp as number) < LOCAL_CACHE_TTL) {
          localProcessedCache.set(issue, timestamp as number);
          loaded++;
        }
      }
      
      // 恢复最后期号
      if (cache.lastIssue) {
        lastIssueLocal = cache.lastIssue;
      }
      
      logger.info({ loaded, lastIssue: lastIssueLocal }, '[缓存] 本地缓存已加载');
    }
  } catch (error: any) {
    logger.warn({ error: error.message }, '[缓存] 加载本地缓存失败');
  }
}

/**
 * 保存本地缓存到文件（持久化）
 */
function saveLocalCache(): void {
  try {
    // 确保目录存在
    const cacheDir = path.dirname(LOCAL_CACHE_FILE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    // 只保存未过期的数据
    const now = Date.now();
    const validCache: Record<string, number> = {};
    
    for (const [issue, timestamp] of localProcessedCache.entries()) {
      if (now - timestamp < LOCAL_CACHE_TTL) {
        validCache[issue] = timestamp;
      }
    }
    
    const data = {
      processed: validCache,
      lastIssue: lastIssueLocal,
      savedAt: now
    };
    
    fs.writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    logger.debug({ count: Object.keys(validCache).length }, '[缓存] 本地缓存已保存');
  } catch (error: any) {
    logger.warn({ error: error.message }, '[缓存] 保存本地缓存失败');
  }
}

/**
 * 清理过期的本地缓存
 */
function cleanLocalCache(): void {
  const now = Date.now();
  const entriesToDelete: string[] = [];
  
  for (const [issue, timestamp] of localProcessedCache.entries()) {
    if (now - timestamp > LOCAL_CACHE_TTL) {
      entriesToDelete.push(issue);
    }
  }
  
  entriesToDelete.forEach(issue => localProcessedCache.delete(issue));
  
  // 清理后保存
  if (entriesToDelete.length > 0) {
    saveLocalCache();
  }
}

/**
 * 检查本地缓存中是否已处理
 */
function isProcessedLocally(issue: string): boolean {
  const timestamp = localProcessedCache.get(issue);
  if (!timestamp) return false;
  
  const now = Date.now();
  if (now - timestamp > LOCAL_CACHE_TTL) {
    localProcessedCache.delete(issue);
    return false;
  }
  
  return true;
}

/**
 * 标记本地缓存已处理
 */
function markProcessedLocally(issue: string): void {
  // 限制缓存大小
  if (localProcessedCache.size >= MAX_LOCAL_CACHE_SIZE) {
    cleanLocalCache();
    // 如果清理后还是太大，删除最旧的一半
    if (localProcessedCache.size >= MAX_LOCAL_CACHE_SIZE) {
      const entries = Array.from(localProcessedCache.entries());
      entries.sort((a, b) => a[1] - b[1]);
      entries.slice(0, Math.floor(entries.length / 2)).forEach(([issue]) => {
        localProcessedCache.delete(issue);
      });
    }
  }
  
  localProcessedCache.set(issue, Date.now());
  
  // 定期持久化（每100个新增保存一次）
  if (localProcessedCache.size % 100 === 0) {
    saveLocalCache();
  }
}

/**
 * 检查期号是否已处理
 * 
 * 查询Redis中是否存在该期号的已处理标记
 * 用于快速判断数据是否需要处理，避免重复操作
 * 
 * @param issue 期号（7位数字字符串）
 * @returns 如果已处理返回true，否则返回false（包括Redis错误的情况）
 * 
 * @example
 * ```typescript
 * if (await isProcessed('2025001')) {
 *   console.log('该期号已处理，跳过');
 * }
 * ```
 */
export async function isProcessed(issue: string): Promise<boolean> {
  // 降级方案：如果Redis不健康，使用本地内存缓存
  if (!getRedisHealthStatus()) {
    return isProcessedLocally(issue);
  }

  try {
    const redis = getRedisClient();
    const seenKey = CacheKeyBuilder.seenKey(issue);
    
    const exists = await redis.exists(seenKey);
    const processed = exists === 1;
    
    // 同步到本地缓存
    if (processed) {
      markProcessedLocally(issue);
    }
    
    return processed;
  } catch (error: any) {
    // Redis操作失败，降级到本地缓存
    logger.debug({ 
      issue,
      errorMessage: error?.message || String(error),
      errorCode: error?.code,
      errorName: error?.name
    }, '检查期号是否已处理失败，使用本地缓存');
    return isProcessedLocally(issue);
  }
}

/**
 * 标记期号已处理
 * 
 * 在Redis中设置该期号的已处理标记，带过期时间
 * 标记会在SEEN_TTL秒后自动过期，避免内存无限增长
 * 
 * @param issue 期号（7位数字字符串）
 * 
 * @example
 * ```typescript
 * await markProcessed('2025001');
 * ```
 */
export async function markProcessed(issue: string): Promise<void> {
  // 始终标记到本地缓存（作为降级方案）
  markProcessedLocally(issue);
  
  // 如果Redis不健康，只使用本地缓存
  if (!getRedisHealthStatus()) {
    return;
  }

  try {
    const redis = getRedisClient();
    const seenKey = CacheKeyBuilder.seenKey(issue);
    
    await redis.setex(seenKey, SEEN_TTL, '1');
    logger.debug({ issue, ttl: SEEN_TTL }, '标记期号已处理');
  } catch (error: any) {
    // Redis失败不影响流程，本地缓存已经标记
    logger.debug({ 
      issue,
      errorMessage: error?.message || String(error),
      errorCode: error?.code,
      errorName: error?.name
    }, '标记期号已处理失败（已使用本地缓存）');
  }
}

/**
 * 获取最后处理的期号（增强版 - 支持降级）
 * 
 * 从Redis获取最近一次成功处理的期号
 * 用于期号递增性校验，判断新数据是否为旧数据
 * 
 * 降级策略：
 * 1. 优先从Redis获取
 * 2. Redis失败时使用本地缓存
 * 
 * @returns 最后处理的期号，如果不存在或出错返回null
 * 
 * @example
 * ```typescript
 * const lastIssue = await getLastIssue();
 * if (lastIssue && newIssue <= lastIssue) {
 *   console.warn('新期号小于等于最后期号，可能是旧数据');
 * }
 * ```
 */
export async function getLastIssue(): Promise<string | null> {
  // 如果Redis不健康，直接返回本地缓存
  if (!getRedisHealthStatus()) {
    return lastIssueLocal;
  }
  
  try {
    const redis = getRedisClient();
    const issue = await redis.get(CacheKeyBuilder.lastIssueKey());
    
    // 同步到本地缓存
    if (issue) {
      lastIssueLocal = issue;
    }
    
    return issue;
  } catch (error: any) {
    // Redis失败，降级到本地缓存
    logger.debug({ 
      errorMessage: error?.message || String(error),
      errorCode: error?.code,
      errorName: error?.name
    }, '[降级] 获取最后期号失败，使用本地缓存');
    return lastIssueLocal;
  }
}

/**
 * 设置最后处理的期号（增强版 - 支持降级）
 * 
 * 更新Redis中最后处理的期号记录
 * 该记录不设置过期时间，会持久保存
 * 
 * 降级策略：
 * 1. 优先写入Redis
 * 2. 同时更新本地缓存
 * 3. 持久化到本地文件
 * 
 * @param issue 期号（7位数字字符串）
 * 
 * @example
 * ```typescript
 * await setLastIssue('2025001');
 * ```
 */
export async function setLastIssue(issue: string): Promise<void> {
  // 始终更新本地缓存
  lastIssueLocal = issue;
  saveLocalCache();
  
  // 如果Redis不健康，只使用本地缓存
  if (!getRedisHealthStatus()) {
    return;
  }
  
  try {
    const redis = getRedisClient();
    await redis.set(CacheKeyBuilder.lastIssueKey(), issue);
    logger.debug({ issue }, '更新最后期号');
  } catch (error: any) {
    // Redis失败不影响流程，本地缓存已经更新
    logger.debug({ 
      issue,
      errorMessage: error?.message || String(error),
      errorCode: error?.code,
      errorName: error?.name
    }, '[降级] 更新最后期号失败（已使用本地缓存）');
  }
}

/**
 * 初始化缓存模块
 * 
 * 在应用启动时调用，加载本地缓存
 */
export function initializeCache(): void {
  loadLocalCache();
  
  // 定期保存缓存（每5分钟）
  setInterval(() => {
    if (localProcessedCache.size > 0) {
      saveLocalCache();
    }
  }, 300000); // 5分钟
  
  // 定期清理过期缓存（每10分钟）
  setInterval(() => {
    cleanLocalCache();
  }, 600000); // 10分钟
}







