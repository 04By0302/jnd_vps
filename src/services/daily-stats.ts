import { readDB, writeDB } from '../database/client';
import { logger } from '../libs/logger';
import { withRetry, batchUpsertStats } from '../database/operations';
import { getBeijingDateString } from '../helpers/datetime';
import { LotteryData } from '../types';
import { collectHitTypes } from '../helpers/lottery-analyzer';
import { createEmptyStatObject } from '../config/stat-types';
import { getRedisClient } from '../libs/redis';
import { CacheKeyBuilder } from '../libs/cache-keys';

/**
 * 每日统计服务
 * 
 * 负责统计每日开奖数据的各项指标，包括：
 * - 大小（和值 >= 14为大，<= 13为小）
 * - 单双（和值奇偶性）
 * - 大小单双组合（dd/xd/ds/xs）
 * - 极值（极大 >= 22，极小 <= 5）
 * - 形态（豹子/对子/顺子/杂六）
 * - 边（小边 0-9，中 10-18，大边 19-27，边=小边+大边）
 * - 龙虎合（龙：num1>num3，虎：num1<num3，合：num1=num3）
 * - 和值分布（00-27）
 * 
 * 数据存储：
 * - 使用 today_stats_data 表
 * - 表结构：id, qihao(日期), omission_type(类型), omission_count(次数), updated_at
 * - 使用日期作为分组键，支持按日查询
 * 
 * 性能优化：
 * - 使用预计算属性，无需重复判断
 * - 批量插入/更新，单次SQL操作
 * - 使用ON DUPLICATE KEY UPDATE实现幂等性
 * - 统计失败不阻塞主流程
 */

/**
 * 更新今日统计
 * 
 * 使用预计算属性，大幅简化代码
 * 增加期号去重检查，避免重复统计
 * 
 * 当有新开奖数据写入时调用此方法更新统计
 * 直接从预计算属性读取类型，无需重新分析
 * 
 * @param data 开奖数据（包含预计算属性）
 * 
 * @example
 * ```typescript
 * await updateTodayStatistics({
 *   qihao: '2025001',
 *   opennum: '3+5+8',
 *   sum_value: 16,
 *   is_da: true,
 *   is_dan: false,
 *   // ... 其他预计算属性
 * });
 * ```
 */
export async function updateTodayStatistics(data: LotteryData): Promise<void> {
  try {
    const todayKey = getTodayKey();
    const redis = getRedisClient();
    
    // 检查该期号是否已统计（避免重复统计）
    const statsKey = CacheKeyBuilder.todayStatsProcessedKey(todayKey, data.qihao);
    const alreadyProcessed = await redis.get(statsKey);
    
    if (alreadyProcessed) {
      logger.debug({ qihao: data.qihao }, '期号已统计，跳过');
      return;
    }
    
    // 直接从预计算属性收集统计类型（使用统一函数）
    const typesToUpdate = collectHitTypes(data);
    
    // 使用统一的批量upsert函数
    await batchUpsertStats('today_stats_data', 'qihao', todayKey, typesToUpdate);
    
    // 标记该期号已统计（当天有效）
    const secondsUntilMidnight = getSecondsUntilMidnight();
    await redis.set(statsKey, '1', 'EX', secondsUntilMidnight);
    
    logger.debug({ qihao: data.qihao }, '今日统计已更新');
  } catch (error) {
    logger.error({ error }, '更新今日统计失败');
  }
}

/**
 * 获取今日键（日期字符串）
 * 使用北京时间（系统本地时间）
 * @returns YYYY-MM-DD格式的日期字符串
 */
function getTodayKey(): string {
  return getBeijingDateString();
}

/**
 * 获取距离今日午夜的秒数
 * 用于设置Redis缓存过期时间
 */
function getSecondsUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.floor((midnight.getTime() - now.getTime()) / 1000);
}



/**
 * 获取今日统计数据
 * 
 * 从数据库读取今日所有统计类型的计数
 * 如果数据库查询失败，返回空统计对象（所有计数为0）
 * 
 * @returns 统计对象，包含所有类型的计数
 * 
 * @example
 * ```typescript
 * const stats = await getTodayStatistics();
 * console.log('今日大号次数:', stats.da);
 * console.log('今日和值16次数:', stats['16']);
 * ```
 */
export async function getTodayStatistics(): Promise<any> {
  try {
    const todayKey = getTodayKey();
    const stats = await queryTodayStats(todayKey);
    return buildStatsResult(stats);
  } catch (error) {
    logger.error({ error }, '获取今日统计失败，返回空统计');
    return createEmptyStatObject();
  }
}

/**
 * 查询今日统计数据
 * @param todayKey 日期键
 * @returns 统计记录数组
 */
async function queryTodayStats(todayKey: string): Promise<Array<{omission_type: string, omission_count: number}>> {
  return await withRetry(
    async () => await readDB.$queryRaw<Array<{omission_type: string, omission_count: number}>>`
      SELECT omission_type, omission_count
      FROM today_stats_data
      WHERE qihao = ${todayKey}
    `,
    { operation: '查询今日统计', maxAttempts: 2 }
  );
}

/**
 * 构建统计结果对象
 * @param stats 统计记录数组
 * @returns 统计对象
 */
function buildStatsResult(stats: Array<{omission_type: string, omission_count: number}>): any {
  const result = createEmptyStatObject();
  
  stats.forEach(stat => {
    result[stat.omission_type] = stat.omission_count;
  });
  
  return result;
}

/**
 * 清理并重建今日统计数据
 * 
 * 用于修复错误的统计数据：
 * 1. 删除今日所有统计记录
 * 2. 重新从开奖数据计算统计
 * 3. 清除Redis缓存
 * 
 * @returns 重建的统计数据
 */
export async function rebuildTodayStatistics(): Promise<any> {
  try {
    const todayKey = getTodayKey();
    const redis = getRedisClient();
    
    logger.info({ date: todayKey }, '开始重建今日统计');
    
    // 1. 删除今日所有统计记录
    await writeDB.$executeRaw`
      DELETE FROM today_stats_data WHERE qihao = ${todayKey}
    `;
    logger.info('已清理今日统计记录');
    
    // 2. 查询今日所有开奖数据
    const todayLottery = await readDB.latest_lottery_data.findMany({
      where: {
        opentime: {
          gte: new Date(todayKey + ' 00:00:00'),
          lt: new Date(todayKey + ' 23:59:59')
        }
      },
      orderBy: { opentime: 'asc' }
    });
    
    logger.info({ count: todayLottery.length }, '查询到今日开奖数据');
    
    // 3. 统计各类型出现次数
    const stats: Record<string, number> = {};
    for (const record of todayLottery) {
      // 转换为 LotteryData 类型
      const lotteryData: LotteryData = {
        qihao: record.qihao,
        opentime: record.opentime.toISOString(),
        opennum: record.opennum,
        sum_value: record.sum_value,
        source: record.source,
        is_da: record.is_da,
        is_xiao: record.is_xiao,
        is_dan: record.is_dan,
        is_shuang: record.is_shuang,
        is_jida: record.is_jida,
        is_jixiao: record.is_jixiao,
        combination: record.combination,
        is_baozi: record.is_baozi,
        is_duizi: record.is_duizi,
        is_shunzi: record.is_shunzi,
        is_zaliu: record.is_zaliu,
        is_xiaobian: record.is_xiaobian,
        is_zhong: record.is_zhong,
        is_dabian: record.is_dabian,
        is_bian: record.is_bian,
        is_long: record.is_long,
        is_hu: record.is_hu,
        is_he: record.is_he
      };
      
      const types = collectHitTypes(lotteryData);
      types.forEach(type => {
        stats[type] = (stats[type] || 0) + 1;
      });
    }
    
    // 4. 批量插入统计数据
    if (Object.keys(stats).length > 0) {
      const values = Object.entries(stats).map(([type, count]) => 
        `('${todayKey}', '${type}', ${count}, NOW())`
      ).join(',');
      
      await writeDB.$executeRawUnsafe(`
        INSERT INTO today_stats_data (qihao, omission_type, omission_count, updated_at)
        VALUES ${values}
      `);
      
      logger.info({ typeCount: Object.keys(stats).length }, '统计数据已重建');
    }
    
    // 5. 清除今日统计相关的Redis缓存
    const pattern = CacheKeyBuilder.todayStatsProcessedPattern(todayKey);
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.info({ keyCount: keys.length }, '已清除Redis缓存');
    }
    
    // 6. 返回重建后的统计
    const result = buildStatsResult(
      Object.entries(stats).map(([omission_type, omission_count]) => ({
        omission_type,
        omission_count
      }))
    );
    
    logger.info('今日统计重建完成');
    return result;
    
  } catch (error) {
    logger.error({ error }, '重建今日统计失败');
    throw error;
  }
}

