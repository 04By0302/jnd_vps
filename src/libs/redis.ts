import Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

let redisClient: Redis | null = null;
let isRedisHealthy = false;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 5000; // 5秒检查一次
let healthCheckTimer: NodeJS.Timeout | null = null;

/**
 * 获取Redis客户端实例（单例模式）
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      // 连接超时配置（跨云公网优化）
      connectTimeout: config.redis.connectTimeout,    // 连接超时（默认30秒）
      commandTimeout: config.redis.commandTimeout,    // 命令超时（默认15秒）
      enableOfflineQueue: true,                       // 允许离线时排队（启动时需要）
      lazyConnect: false,                             // 立即连接
      maxRetriesPerRequest: 3,                        // 每个请求最多重试3次
      enableReadyCheck: true,                         // 启用就绪检查
      // TCP Keepalive配置（保持长连接稳定）
      keepAlive: config.redis.keepAlive,              // 启用TCP Keepalive（默认30秒）
      // 连接池配置（优化高并发性能）
      maxLoadingRetryTime: 3000,                      // 加载脚本最大重试时间
      autoResubscribe: true,                          // 自动重新订阅
      autoResendUnfulfilledCommands: true,            // 自动重发未完成的命令
      // 重试策略（优化版）
      retryStrategy(times) {
        if (times > 10) {
          logger.error('[失败] Redis重连失败次数过多，停止重试');
          return null; // 停止重试
        }
        const delay = Math.min(times * 500, 3000);
        logger.warn(`[重连] Redis重连中，第${times}次尝试，延迟${delay}ms`);
        return delay;
      },
      // 针对特定错误重连
      reconnectOnError(err) {
        const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EPIPE', 'ECONNREFUSED'];
        if (targetErrors.some(e => err.message.includes(e))) {
          logger.warn({ error: err.message }, '[警告] Redis遇到可恢复错误，尝试重连');
          return true;
        }
        return false;
      }
    });

    // 错误监听（不阻塞启动）
    redisClient.on('error', (err: any) => {
      // 只记录错误，不抛出异常
      logger.warn({ 
        error: err.message,
        code: err.code || err.name,
        host: config.redis.host,
        port: config.redis.port
      }, 'Redis连接错误（将继续重试）');
    });

    // 连接成功监听
    redisClient.on('connect', () => {
      logger.info({ 
        host: config.redis.host,
        port: config.redis.port
      }, 'Redis连接成功');
    });

    // 重连监听
    redisClient.on('reconnecting', (delay: number) => {
      logger.warn({ 
        delay,
        host: config.redis.host,
        port: config.redis.port
      }, 'Redis正在重连...');
    });

    // 就绪监听
    redisClient.on('ready', () => {
      logger.info({ 
        host: config.redis.host,
        port: config.redis.port
      }, 'Redis已就绪，可以接受命令');
      isRedisHealthy = true;
    });

    // 断开连接监听
    redisClient.on('close', () => {
      logger.warn({ 
        host: config.redis.host,
        port: config.redis.port
      }, 'Redis连接已关闭');
      isRedisHealthy = false;
    });

    // 结束监听
    redisClient.on('end', () => {
      logger.warn({ 
        host: config.redis.host,
        port: config.redis.port
      }, 'Redis连接已结束');
      isRedisHealthy = false;
    });
  }

  return redisClient;
}

/**
 * 检查Redis健康状态
 * 
 * 使用缓存机制，避免频繁ping操作
 * 每5秒最多检查一次
 * 
 * @returns Redis是否健康
 */
export async function isRedisAvailable(): Promise<boolean> {
  const now = Date.now();
  
  // 使用缓存的健康状态，避免频繁检查
  if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return isRedisHealthy;
  }
  
  try {
    const client = getRedisClient();
    await client.ping();
    isRedisHealthy = true;
    lastHealthCheck = now;
    return true;
  } catch (error: any) {
    isRedisHealthy = false;
    lastHealthCheck = now;
    logger.warn({ 
      errorMessage: error?.message || String(error),
      errorCode: error?.code 
    }, 'Redis健康检查失败');
    return false;
  }
}

/**
 * 获取Redis当前健康状态（不执行检查）
 * 
 * @returns Redis是否健康
 */
export function getRedisHealthStatus(): boolean {
  return isRedisHealthy;
}

/**
 * 启动定期健康检查
 * 
 * 每隔HEALTH_CHECK_INTERVAL毫秒检查一次Redis连接状态
 * 在应用启动时调用
 */
export function startRedisHealthCheck(): void {
  if (healthCheckTimer) {
    return; // 已经启动
  }
  
  logger.info('启动Redis健康检查');
  
  // 立即执行一次检查
  isRedisAvailable().catch(() => {});
  
  // 定期检查
  healthCheckTimer = setInterval(async () => {
    await isRedisAvailable();
  }, HEALTH_CHECK_INTERVAL);
}

/**
 * 停止定期健康检查
 */
export function stopRedisHealthCheck(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    logger.info('停止Redis健康检查');
  }
}

/**
 * 关闭Redis连接
 */
export async function closeRedis(): Promise<void> {
  stopRedisHealthCheck();
  
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    isRedisHealthy = false;
    logger.info('Redis连接已关闭');
  }
}

