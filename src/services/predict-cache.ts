import fs from 'fs/promises';
import { getRedisClient } from '../libs/redis';
import { readDB } from '../database/client';
import { config } from '../config';
import { logger } from '../libs/logger';
import { PredictType, PredictData } from '../types';
import { withRetry } from '../database/operations';

/**
 * 预测数据缓存服务
 * 
 * 二级缓存架构（降级方案）：
 * 1. Redis缓存（优先）- 最快，TTL 180秒
 * 2. 数据库查询 → 静态文件降级 - 可靠且有降级保护
 * 
 * 前后端分离说明：
 * - 前端通过API获取数据，API优先使用Redis缓存
 * - 静态文件不直接对外暴露，仅作为数据库故障时的降级方案
 * - 新数据写入时，统一缓存管理模块会清除Redis缓存
 * 
 * 缓存更新机制：
 * - 新数据写入后，cache-manager统一清除所有预测缓存
 * - 下次API请求时，Redis未命中，直接查询数据库
 * - 数据库故障时，降级读取静态文件
 * - 读取后自动写入Redis，供后续请求使用
 */


/**
 * 获取预测数据（带缓存）
 * @param predictType 预测类型
 * @param limit 查询数量
 * @returns 预测数据数组
 */
export async function getPredictDataWithCache(
  predictType: PredictType,
  limit: number
): Promise<PredictData[]> {
  const redis = getRedisClient();
  const cacheKey = `predict:${predictType}:limit:${limit}`;

  try {
    // 第一级：尝试从Redis读取
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug(`预测数据缓存命中 类型:${predictType} limit:${limit}`);
      return JSON.parse(cached);
    }

    // 第二级：从数据库查询
    try {
      const dbData = await queryFromDatabase(predictType, limit);
      
      // 写入Redis缓存（180秒TTL）
      await redis.setex(cacheKey, 180, JSON.stringify(dbData));
      logger.debug(`从数据库查询预测数据 类型:${predictType} limit:${limit}`);
      
      return dbData;
    } catch (dbError) {
      // 降级：数据库故障时读取静态文件
      logger.warn({ error: dbError, predictType, limit }, '数据库查询失败，尝试读取静态文件');
      const fileData = await readFromStaticFile(predictType, limit);
      if (fileData) {
        // 写入Redis缓存（180秒TTL）
        await redis.setex(cacheKey, 180, JSON.stringify(fileData));
        logger.debug(`从静态文件读取预测数据（降级） 类型:${predictType} limit:${limit}`);
        return fileData;
      }
      throw new Error('数据库和静态文件均不可用');
    }
  } catch (error) {
    logger.error({ error, predictType, limit }, '获取预测数据失败');
    throw error;
  }
}

/**
 * 从静态JSON文件读取
 */
async function readFromStaticFile(
  predictType: PredictType,
  limit: number
): Promise<PredictData[] | null> {
  try {
    const filenameMap: Record<PredictType, string> = {
      [PredictType.DANSHUANG]: 'ds.json',
      [PredictType.DAXIAO]: 'dx.json',
      [PredictType.COMBINATION]: 'zh.json',
      [PredictType.KILL]: 'sha.json'
    };

    const filename = filenameMap[predictType];
    const filePath = config.getOutputPath(filename);
    
    const content = await fs.readFile(filePath, 'utf-8');
    const jsonData = JSON.parse(content);
    
    // 静态文件包含20条数据，如果需要的数量少于等于20，直接返回
    if (jsonData.data && jsonData.data.length >= limit) {
      return jsonData.data.slice(0, limit); // AI已直接返回双组合
    }
    
    return null;
  } catch (error) {
    // 文件不存在或解析失败，返回null触发数据库查询
    return null;
  }
}

/**
 * 从数据库查询
 */
async function queryFromDatabase(
  predictType: PredictType,
  limit: number
): Promise<PredictData[]> {
  const records = await withRetry(
    async () => {
      return await readDB.ai_predictions.findMany({
        where: { predict_type: predictType },
        orderBy: { qihao: 'desc' },
        take: limit
      });
    },
    { operation: `查询预测数据(${predictType})` }
  );

  return records.map((record: any) => ({
    qihao: record.qihao,
    predict: record.predict_value, // AI已直接返回双组合，无需转换
    opennum: record.opennum,
    sum: record.sum_value !== null ? String(record.sum_value) : null,
    result: record.result_value,
    hit: record.hit
  }));
}

/**
 * 清除预测数据缓存
 * 在生成新的预测JSON文件后调用
 */
export async function clearPredictCache(predictType?: PredictType): Promise<void> {
  const redis = getRedisClient();
  
  try {
    if (predictType) {
      // 清除特定类型的所有limit缓存
      const pattern = `predict:${predictType}:limit:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.debug(`清除预测缓存 类型:${predictType} 数量:${keys.length}`);
      }
    } else {
      // 清除所有预测缓存
      const pattern = 'predict:*:limit:*';
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.debug(`清除所有预测缓存 数量:${keys.length}`);
      }
    }
  } catch (error) {
    logger.warn({ error, predictType }, '清除预测缓存失败');
  }
}



