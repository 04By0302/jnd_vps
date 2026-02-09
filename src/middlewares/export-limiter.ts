import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../libs/redis';
import { logger } from '../libs/logger';

/**
 * Excel导出并发控制中间件
 * 
 * 功能：
 * - 限制同时导出的最大数量为3个
 * - 防止Excel生成占用过多服务器资源
 * - 超过限制时返回503状态码
 * 
 * 实现：
 * - 使用Redis计数器跟踪当前并发数
 * - 请求开始时incr，结束时decr
 * - 超过MAX_CONCURRENT时拒绝请求
 */

const CONCURRENT_KEY = 'excel:concurrent:count';
const MAX_CONCURRENT = 3;

export async function exportLimiter(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const redis = getRedisClient();
  
  try {
    // 增加并发计数
    const current = await redis.incr(CONCURRENT_KEY);
    
    // 检查是否超过限制
    if (current > MAX_CONCURRENT) {
      await redis.decr(CONCURRENT_KEY);
      res.status(503).json({ 
        error: '系统繁忙，请稍后重试',
        message: 'Server is busy, please try again later'
      });
      return;
    }
    
    // 设置清理函数，无论成功或失败都要减少计数
    const cleanup = async () => {
      try {
        await redis.decr(CONCURRENT_KEY);
      } catch (error) {
        logger.error({ error }, 'Excel导出并发计数清理失败');
      }
    };
    
    // 在响应结束时清理
    res.on('finish', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    
    // 继续处理请求
    next();
  } catch (error) {
    logger.error({ error }, 'Excel导出并发控制失败');
    // 出错时也要尝试清理
    try {
      await redis.decr(CONCURRENT_KEY);
    } catch (e) {
      // 忽略清理错误
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

/**
 * 检查Excel缓存
 * 
 * 从Redis读取缓存的Excel文件Buffer
 * 缓存策略：
 * - TTL: 180秒（统一标准）
 * - 清除: 新数据写入时由cache-manager统一清除
 * 
 * @param cacheKey Redis缓存键
 * @returns 缓存的Buffer或null
 */
export async function checkExcelCache(cacheKey: string): Promise<Buffer | null> {
  const redis = getRedisClient();
  
  try {
    const cached = await redis.getBuffer(cacheKey);
    if (cached) {
      logger.debug(`Excel缓存命中 key:${cacheKey}`);
      return cached;
    }
    return null;
  } catch (error) {
    logger.warn({ error, cacheKey }, 'Excel缓存读取失败');
    return null;
  }
}

/**
 * 设置Excel缓存
 * 
 * 将生成的Excel文件Buffer存入Redis缓存
 * 
 * 缓存策略：
 * - TTL: 180秒（统一标准）
 * - 作为兜底：即使有主动清除，TTL也会自动过期
 * - 新数据写入时，cache-manager会主动清除所有Excel缓存
 * 
 * @param cacheKey Redis缓存键
 * @param buffer Excel文件Buffer
 * @param ttl 缓存时间（秒），默认180秒
 */
export async function setExcelCache(
  cacheKey: string,
  buffer: Buffer,
  ttl: number = 180
): Promise<void> {
  const redis = getRedisClient();
  
  try {
    await redis.setex(cacheKey, ttl, buffer);
    logger.debug(`Excel缓存已设置 key:${cacheKey} size:${buffer.length}字节`);
  } catch (error) {
    logger.warn({ error, cacheKey }, 'Excel缓存写入失败');
  }
}

