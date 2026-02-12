import { getRedisClient } from '../libs/redis';
import { logger } from '../libs/logger';
import { CacheKeyBuilder } from '../libs/cache-keys';

/**
 * 统一缓存管理服务
 * 
 * 职责：
 * - 在新数据写入后统一清除所有相关缓存
 * - 确保用户通过API获取的数据始终是最新的
 * - 提供集中的缓存清除接口，便于维护和审计
 * 
 * 设计原则：
 * - 前后端完全分离：API完全依赖数据库+Redis缓存
 * - 主动清除策略：不依赖TTL过期，新数据到来时主动清除
 * - 容错设计：单个缓存清除失败不影响整体流程
 * 
 * 调用时机：
 * - 新数据写入完成后（dataWritten事件）
 * - JSON文件生成完成后（generateAllJson, generateAllPredictJson）
 */

/**
 * 清除开奖数据相关缓存（不含预测缓存）
 * 
 * 在新数据写入后调用，仅清除开奖相关缓存
 * 
 * 清除范围：
 * - Redis缓存：开奖数据、遗漏统计、已开统计、Excel导出
 * - Cloudflare CDN缓存：数据API的边缘节点缓存
 * 
 * 不清除预测缓存：
 * - 避免时序竞争：新数据写入后，AI预测尚未完成
 * - 预测缓存在AI预测完成后单独清除
 * 
 * 错误处理：单个类型缓存清除失败不影响其他类型
 */
export async function clearDataCachesExceptPredict(): Promise<void> {
  const operations = [
    // Redis缓存清除（不含预测）
    { name: 'Redis-开奖数据', fn: clearKjCaches },
    { name: 'Redis-遗漏统计', fn: clearYlCache },
    { name: 'Redis-已开统计', fn: clearYkCache },
    { name: 'Redis-Excel导出', fn: clearExcelCaches }
  ];

  const results = await Promise.allSettled(
    operations.map(op => op.fn())
  );

  // 记录失败的操作
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.warn({ 
        type: operations[index].name,
        error: result.reason 
      }, '缓存清除失败');
    }
  });
}

/**
 * 清除所有数据相关缓存（包含预测缓存）
 * 
 * 已废弃：建议使用 clearDataCachesExceptPredict + clearPredictCaches 分离调用
 * 
 * 清除范围：
 * - Redis缓存：开奖数据、遗漏统计、已开统计、预测数据、Excel导出
 * - Cloudflare CDN缓存：数据API的边缘节点缓存
 * 
 * 错误处理：单个类型缓存清除失败不影响其他类型
 * 
 * @deprecated 请使用 clearDataCachesExceptPredict，避免预测缓存时序竞争
 */
export async function clearAllDataCaches(): Promise<void> {
  const operations = [
    // Redis缓存清除
    { name: 'Redis-开奖数据', fn: clearKjCaches },
    { name: 'Redis-遗漏统计', fn: clearYlCache },
    { name: 'Redis-已开统计', fn: clearYkCache },
    { name: 'Redis-预测数据', fn: clearPredictCaches },
    { name: 'Redis-Excel导出', fn: clearExcelCaches }
  ];

  const results = await Promise.allSettled(
    operations.map(op => op.fn())
  );

  // 记录失败的操作
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.warn({ 
        type: operations[index].name,
        error: result.reason 
      }, '缓存清除失败');
    }
  });
}


/**
 * 清除开奖数据API缓存
 * 
 * 缓存键模式：kj:limit:*
 * 说明：kj.json API支持limit参数，不同limit对应不同缓存键
 */
async function clearKjCaches(): Promise<void> {
  await clearCacheByPattern(CacheKeyBuilder.kjLimitPattern(), '开奖数据');
}


/**
 * 清除遗漏统计API缓存
 * 
 * 缓存键：yl
 * 说明：yl.json API返回固定结构的遗漏统计数据
 */
async function clearYlCache(): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(CacheKeyBuilder.ylKey());
    logger.debug('遗漏统计缓存已清除');
  } catch (error) {
    logger.warn({ error }, '遗漏统计缓存清除失败');
    throw error;
  }
}

/**
 * 清除已开统计API缓存
 * 
 * 缓存键：yk
 * 说明：yk.json API返回今日已开统计数据
 */
async function clearYkCache(): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(CacheKeyBuilder.ykKey());
    logger.debug('已开统计缓存已清除');
  } catch (error) {
    logger.warn({ error }, '已开统计缓存清除失败');
    throw error;
  }
}

/**
 * 清除预测数据缓存
 * 
 * 缓存键模式：predict:*:limit:*
 * 说明：包括单双、大小、组合、杀组合四种预测类型
 */
export async function clearPredictCaches(): Promise<void> {
  await clearCacheByPattern(CacheKeyBuilder.predictPattern(), '预测数据');
}

/**
 * 清除Excel导出缓存
 * 
 * 缓存键模式：excel:lottery:*, excel:stats:*
 * 说明：包括开奖数据Excel和统计数据Excel
 */
async function clearExcelCaches(): Promise<void> {
  await Promise.all([
    clearCacheByPattern(CacheKeyBuilder.excelLotteryPattern(), 'Excel开奖数据'),
    clearCacheByPattern(CacheKeyBuilder.excelStatsPattern(), 'Excel统计数据')
  ]);
}

/**
 * 通用缓存清除函数
 * 
 * 使用Redis SCAN命令迭代查找匹配的键，然后批量删除
 * 
 * 优化说明：
 * - 使用SCAN代替KEYS，避免阻塞Redis
 * - 非阻塞迭代，适合生产环境
 * - 批量删除，每次最多1000个键
 * 
 * 性能对比：
 * - KEYS: 阻塞操作，扫描所有键，O(N)
 * - SCAN: 非阻塞迭代，渐进式扫描，O(N)但不阻塞
 */
async function clearCacheByPattern(
  pattern: string, 
  description: string
): Promise<void> {
  try {
    const redis = getRedisClient();
    const keys: string[] = [];
    let cursor = '0';
    
    // 使用SCAN迭代查找匹配的键
    do {
      const result = await redis.scan(
        cursor,
        'MATCH', pattern,
        'COUNT', 100 // 每次迭代返回约100个键
      );
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    
    // 批量删除，每次最多1000个
    if (keys.length > 0) {
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        await redis.del(...batch);
      }
      logger.debug({ pattern, count: keys.length }, `${description}缓存已清除`);
    }
  } catch (error) {
    logger.warn({ error, pattern }, `${description}缓存清除失败`);
    throw error;
  }
}

