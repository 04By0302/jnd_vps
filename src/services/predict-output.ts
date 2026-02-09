import fs from 'fs/promises';
import { readDB } from '../database/client';
import { config } from '../config';
import { logger } from '../libs/logger';
import { getRedisClient } from '../libs/redis';
import { PredictType, PredictJsonOutput, PredictData } from '../types';
import { withRetry } from '../database/operations';

/**
 * 生成单个预测JSON文件
 */
export async function generatePredictJson(predictType: PredictType, filename: string): Promise<void> {
  try {
    // 查询该类型的预测数据（最近20期）
    const records = await withRetry(
      async () => {
        return await readDB.ai_predictions.findMany({
          where: {
            predict_type: predictType
          },
          orderBy: {
            qihao: 'desc'
          },
          take: 20
        });
      },
      { operation: `查询预测数据(${predictType})` }
    );

    // 转换为输出格式
    const data: PredictData[] = records.map((record: any) => ({
      qihao: record.qihao,
      predict: record.predict_value,
      opennum: record.opennum,
      sum: record.sum_value !== null ? String(record.sum_value) : null,
      result: record.result_value,
      hit: record.hit
    }));

    const output: PredictJsonOutput = {
      type: predictType,
      data,
      message: 'success'
    };

    // 写入文件
    const filePath = config.getOutputPath(filename);
    await fs.writeFile(filePath, JSON.stringify(output, null, 2), 'utf-8');

    logger.debug(`预测JSON已生成 类型:${predictType} 文件:${filename} 数量:${data.length}`);
  } catch (error) {
    logger.error(`生成预测JSON失败 类型:${predictType} 文件:${filename} 错误:${error}`);
    throw error;
  }
}

/**
 * 生成ds.json（单双预测）
 */
export async function generateDsJson(): Promise<void> {
  await generatePredictJson(PredictType.DANSHUANG, 'ds.json');
}

/**
 * 生成dx.json（大小预测）
 */
export async function generateDxJson(): Promise<void> {
  await generatePredictJson(PredictType.DAXIAO, 'dx.json');
}

/**
 * 生成zh.json（组合预测）
 */
export async function generateZhJson(): Promise<void> {
  await generatePredictJson(PredictType.COMBINATION, 'zh.json');
}

/**
 * 生成sha.json（杀组合预测）
 */
export async function generateShaJson(): Promise<void> {
  await generatePredictJson(PredictType.KILL, 'sha.json');
}

/**
 * 根据预测类型生成对应的JSON文件
 * 用于独立流式处理
 */
export async function generatePredictJsonByType(predictType: PredictType): Promise<void> {
  const filenameMap: Record<PredictType, string> = {
    [PredictType.DANSHUANG]: 'ds.json',
    [PredictType.DAXIAO]: 'dx.json',
    [PredictType.COMBINATION]: 'zh.json',
    [PredictType.KILL]: 'sha.json'
  };

  const filename = filenameMap[predictType];
  if (!filename) {
    throw new Error(`未知的预测类型: ${predictType}`);
  }

  await generatePredictJson(predictType, filename);
}

/**
 * 更新胜率缓存（优化版）
 * 从数据库查询近100期已开奖数据计算胜率
 * 每次所有预测完成后自动调用
 */
export async function updateWinrateCache(): Promise<void> {
  const redis = getRedisClient();
  const types: Array<{ predictType: PredictType; typeName: string }> = [
    { predictType: PredictType.DANSHUANG, typeName: 'danshuang' },
    { predictType: PredictType.DAXIAO, typeName: 'daxiao' },
    { predictType: PredictType.COMBINATION, typeName: 'combination' },
    { predictType: PredictType.KILL, typeName: 'kill' }
  ];
  
  for (const { predictType, typeName } of types) {
    try {
      // 从数据库查询近100期已开奖的数据（hit不为null表示已开奖）
      const records = await withRetry(
        async () => {
          return await readDB.ai_predictions.findMany({
            where: {
              predict_type: predictType,
              hit: { not: null } // 只查询已开奖的数据
            },
            orderBy: {
              qihao: 'desc'
            },
            take: 100 // 近100期
          });
        },
        { operation: `查询胜率数据(${predictType})` }
      );
      
      // 计算胜率
      const total = records.length;
      const hits = records.filter((r: any) => r.hit === true).length;
      const winRate = total > 0 ? ((hits / total) * 100).toFixed(2) : '0.00';
      
      // 写入Redis缓存
      const cacheData = {
        type: typeName,
        total,
        hits,
        misses: total - hits,
        winRate,
        message: 'success'
      };
      
      await redis.setex(
        `project:winrate:${typeName}`,
        config.cache.winrateTTL, // 使用配置的TTL（5分钟）
        JSON.stringify(cacheData)
      );
      
      logger.debug(`胜率缓存已更新 类型:${typeName} 胜率:${winRate}% (${hits}/${total})`);
    } catch (error) {
      logger.warn({ error, type: typeName }, '更新胜率缓存失败');
    }
  }
}

/**
 * 生成所有预测JSON文件
 * 
 * 功能说明：
 * - 生成预测静态JSON文件（ds、dx、zh、sha）
 * - 文件仅作为降级备用方案
 * - 更新胜率缓存（用于胜率API）
 * - 缓存清除由统一的cache-manager模块负责
 */
export async function generateAllPredictJson(): Promise<void> {
  const results = await Promise.allSettled([
    generateDsJson(),
    generateDxJson(),
    generateZhJson(),
    generateShaJson()
  ]);

  // 检查失败的任务
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const names = ['ds.json', 'dx.json', 'zh.json', 'sha.json'];
      logger.error(`预测JSON生成失败 文件:${names[index]} 错误:${result.reason}`);
    }
  });
  
  // 更新胜率缓存（异步，不阻塞主流程）
  updateWinrateCache().catch(err => {
    logger.warn({ error: err }, '更新胜率缓存失败');
  });
  
  // 注意：预测缓存清除已移至统一的cache-manager模块
}


