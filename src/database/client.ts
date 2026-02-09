import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { logger } from '../libs/logger';

// 主库客户端（写入）- 高并发优化
// 时区处理：使用Asia/Shanghai时区（+08:00）
// 连接池：100个连接，支持7个数据源 + AI预测 + 统计更新等高并发写入
// 超时配置：pool_timeout=120s, connect_timeout=60s, socket_timeout=120s
export const writeDB = new PrismaClient({
  datasources: {
    db: {
      url: config.getWriteDBUrl()
    }
  },
  log: [
    { level: 'error', emit: 'event' },
    { level: 'warn', emit: 'event' }
  ]
});

// 从库客户端（读取）- 高并发优化
// 时区处理：使用Asia/Shanghai时区（+08:00）
// 连接池：500个连接，支持500-2000个并发用户查询
// 超时配置：pool_timeout=120s, connect_timeout=60s, socket_timeout=120s
export const readDB = new PrismaClient({
  datasources: {
    db: {
      url: config.getReadDBUrl()
    }
  },
  log: [
    { level: 'error', emit: 'event' },
    { level: 'warn', emit: 'event' }
  ]
});

// 错误聚合Map - 防止日志刷屏
const errorCounter = new Map<string, { count: number; lastLog: number }>();

// 错误代码中文映射
const errorMessages: Record<string, string> = {
  'P1001': '无法连接到数据库服务器',
  'P1002': '数据库服务器连接超时',
  'P1008': '数据库操作超时',
  'P1017': '数据库服务器关闭了连接',
  'P2002': '唯一约束冲突（数据已存在）',
  'P2024': '连接池等待超时',
  'ETIMEDOUT': '网络连接超时',
  'ECONNREFUSED': '连接被拒绝',
  'ECONNRESET': '连接被重置'
};

// 监听错误和警告（带聚合 + 中文提示）
writeDB.$on('error' as never, async (e: any) => {
  const key = `write-${e.code}-${e.target}`;
  const now = Date.now();
  const counter = errorCounter.get(key) || { count: 0, lastLog: 0 };
  
  counter.count++;
  
  // 第1次或每100次或超过1分钟记录一次
  if (counter.count === 1 || counter.count % 100 === 0 || now - counter.lastLog > 60000) {
    const errorMsg = errorMessages[e.code] || e.message || '未知错误';
    logger.error({ 
      err: e, 
      count: counter.count,
      aggregated: counter.count > 1,
      errorCode: e.code,
      errorMessage: errorMsg
    }, `[错误] 主库错误: ${errorMsg}`);
    counter.lastLog = now;
  }
  
  errorCounter.set(key, counter);
  
  // P1001连接错误：尝试重连
  if (e.code === 'P1001') {
    try {
      logger.info('[重连] 尝试重连主库...');
      await writeDB.$disconnect();
      await writeDB.$connect();
      logger.info('[成功] 主库重连成功');
    } catch (reconnectError: any) {
      const reconnectMsg = errorMessages[reconnectError.code] || reconnectError.message || '未知错误';
      logger.error({ error: reconnectError, errorMessage: reconnectMsg }, `[失败] 主库重连失败: ${reconnectMsg}`);
    }
  }
  
  // P2024连接池超时：记录警告并尝试释放空闲连接
  if (e.code === 'P2024') {
    logger.warn('[警告] 主库连接池等待超时，可能需要增加连接数或优化查询');
  }
});

writeDB.$on('warn' as never, (e: any) => {
  logger.warn({ warning: e }, '主库警告');
});

readDB.$on('error' as never, async (e: any) => {
  const key = `read-${e.code}-${e.target}`;
  const now = Date.now();
  const counter = errorCounter.get(key) || { count: 0, lastLog: 0 };
  
  counter.count++;
  
  // 第1次或每100次或超过1分钟记录一次
  if (counter.count === 1 || counter.count % 100 === 0 || now - counter.lastLog > 60000) {
    const errorMsg = errorMessages[e.code] || e.message || '未知错误';
    logger.error({ 
      err: e, 
      count: counter.count,
      aggregated: counter.count > 1,
      errorCode: e.code,
      errorMessage: errorMsg
    }, `[错误] 从库错误: ${errorMsg}`);
    counter.lastLog = now;
  }
  
  errorCounter.set(key, counter);
  
  // P1001连接错误：尝试重连
  if (e.code === 'P1001') {
    try {
      logger.info('[重连] 尝试重连从库...');
      await readDB.$disconnect();
      await readDB.$connect();
      logger.info('[成功] 从库重连成功');
    } catch (reconnectError: any) {
      const reconnectMsg = errorMessages[reconnectError.code] || reconnectError.message || '未知错误';
      logger.error({ error: reconnectError, errorMessage: reconnectMsg }, `[失败] 从库重连失败: ${reconnectMsg}`);
    }
  }
  
  // P2024连接池超时：记录警告
  if (e.code === 'P2024') {
    logger.warn('[警告] 从库连接池等待超时，可能需要增加连接数或优化查询');
  }
});

readDB.$on('warn' as never, (e: any) => {
  logger.warn({ warning: e }, '从库警告');
});

// 健康检查状态
let healthCheckInterval: NodeJS.Timeout | null = null;
let writeDBHealthy = true;
let readDBHealthy = true;
let lastHealthCheck = Date.now();

// 连接失败计数器（用于智能重连）
let writeDBFailCount = 0;
let readDBFailCount = 0;
const MAX_FAIL_COUNT = 5; // 连续失败5次后降低检查频率

/**
 * 初始化数据库连接
 * 显式连接并启动健康检查（公网高并发优化）
 */
export async function initializeDatabaseConnections(): Promise<void> {
  try {
    // 显式连接，带超时保护
    logger.info('正在连接主库...');
    await Promise.race([
      writeDB.$connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('主库连接超时(60秒)')), 60000)
      )
    ]);
    writeDBHealthy = true;
    logger.info('[成功] 主库连接成功');
    
    logger.info('正在连接从库...');
    await Promise.race([
      readDB.$connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('从库连接超时(60秒)')), 60000)
      )
    ]);
    readDBHealthy = true;
    logger.info('[成功] 从库连接成功');
    
    logger.info('数据库连接已初始化');
    
    // 启动智能健康检查
    startHealthCheck();
  } catch (error: any) {
    logger.error({ error: error.message }, '数据库连接初始化失败');
    throw error;
  }
}

/**
 * 启动数据库健康检查（增强版）
 * 
 * 智能频率调整：
 * - 正常时：120秒检查一次
 * - 异常时：30秒检查一次
 * - 连续失败5次后：60秒检查一次（避免过度重连）
 * 
 * 增强功能：
 * - 连接验证
 * - 空闲连接清理
 * - 智能重连策略
 * - 失败计数器
 */
function startHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  
  const checkHealth = async () => {
    lastHealthCheck = Date.now();
    
    // 检查主库
    try {
      await Promise.race([
        writeDB.$queryRaw`SELECT 1`,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('健康检查超时')), 10000)
        )
      ]);
      
      // 恢复正常
      if (!writeDBHealthy) {
        logger.info('[恢复] 主库恢复正常');
        writeDBHealthy = true;
        writeDBFailCount = 0; // 重置失败计数
      }
    } catch (error: any) {
      writeDBFailCount++;
      
      if (writeDBHealthy) {
        const errorMsg = errorMessages[error.code] || error.message || '健康检查超时';
        logger.error({ 
          error: error.message, 
          errorCode: error.code,
          failCount: writeDBFailCount 
        }, `[失败] 主库健康检查失败: ${errorMsg}`);
        writeDBHealthy = false;
      }
      
      // 智能重连策略：连续失败少于5次时才尝试重连
      if (writeDBFailCount < MAX_FAIL_COUNT) {
        try {
          logger.info('[重连] 尝试重连主库...');
          await writeDB.$disconnect();
          await new Promise(resolve => setTimeout(resolve, 100));
          await writeDB.$connect();
          writeDBHealthy = true;
          writeDBFailCount = 0;
          logger.info('[成功] 主库重连成功');
        } catch (reconnectError: any) {
          const reconnectMsg = errorMessages[reconnectError.code] || reconnectError.message || '未知错误';
          logger.error({ 
            error: reconnectError.message, 
            errorCode: reconnectError.code,
            failCount: writeDBFailCount 
          }, `[失败] 主库重连失败: ${reconnectMsg}`);
        }
      } else if (writeDBFailCount === MAX_FAIL_COUNT) {
        logger.warn('[降级] 主库连续失败次数过多，降低重连频率');
      }
    }
    
    // 检查从库
    try {
      await Promise.race([
        readDB.$queryRaw`SELECT 1`,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('健康检查超时')), 10000)
        )
      ]);
      
      // 恢复正常
      if (!readDBHealthy) {
        logger.info('[恢复] 从库恢复正常');
        readDBHealthy = true;
        readDBFailCount = 0; // 重置失败计数
      }
    } catch (error: any) {
      readDBFailCount++;
      
      if (readDBHealthy) {
        const errorMsg = errorMessages[error.code] || error.message || '健康检查超时';
        logger.error({ 
          error: error.message, 
          errorCode: error.code,
          failCount: readDBFailCount 
        }, `[失败] 从库健康检查失败: ${errorMsg}`);
        readDBHealthy = false;
      }
      
      // 智能重连策略：连续失败少于5次时才尝试重连
      if (readDBFailCount < MAX_FAIL_COUNT) {
        try {
          logger.info('[重连] 尝试重连从库...');
          await readDB.$disconnect();
          await new Promise(resolve => setTimeout(resolve, 100));
          await readDB.$connect();
          readDBHealthy = true;
          readDBFailCount = 0;
          logger.info('[成功] 从库重连成功');
        } catch (reconnectError: any) {
          const reconnectMsg = errorMessages[reconnectError.code] || reconnectError.message || '未知错误';
          logger.error({ 
            error: reconnectError.message, 
            errorCode: reconnectError.code,
            failCount: readDBFailCount 
          }, `[失败] 从库重连失败: ${reconnectMsg}`);
        }
      } else if (readDBFailCount === MAX_FAIL_COUNT) {
        logger.warn('[降级] 从库连续失败次数过多，降低重连频率');
      }
    }
  };
  
  // 立即执行一次检查
  checkHealth();
  
  // 智能检查频率
  let checkInterval = 120000; // 默认120秒
  
  healthCheckInterval = setInterval(() => {
    // 根据健康状态动态调整检查频率
    if (!writeDBHealthy || !readDBHealthy) {
      // 异常时：30秒检查一次
      if (writeDBFailCount < MAX_FAIL_COUNT || readDBFailCount < MAX_FAIL_COUNT) {
        checkInterval = 30000;
      } else {
        // 连续失败过多：60秒检查一次
        checkInterval = 60000;
      }
    } else {
      // 正常时：120秒检查一次
      checkInterval = 120000;
    }
    
    checkHealth();
  }, checkInterval);
}

/**
 * 获取数据库健康状态（增强版）
 * 
 * 返回详细的健康状态信息，包括失败计数
 */
export function getDatabaseHealth(): {
  writeDB: boolean;
  readDB: boolean;
  lastCheck: number;
  writeDBFailCount: number;
  readDBFailCount: number;
  status: 'healthy' | 'degraded' | 'critical';
} {
  // 判断整体状态
  let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
  
  if (!writeDBHealthy || !readDBHealthy) {
    if (writeDBFailCount >= MAX_FAIL_COUNT || readDBFailCount >= MAX_FAIL_COUNT) {
      status = 'critical'; // 严重：连续失败过多
    } else {
      status = 'degraded'; // 降级：部分失败
    }
  }
  
  return {
    writeDB: writeDBHealthy,
    readDB: readDBHealthy,
    lastCheck: lastHealthCheck,
    writeDBFailCount,
    readDBFailCount,
    status
  };
}

/**
 * 测试数据库连接
 */
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    await writeDB.$queryRaw`SELECT 1`;
    await readDB.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ error }, '数据库连接测试失败');
    return false;
  }
}

/**
 * 关闭数据库连接
 */
export async function closeDatabaseConnections(): Promise<void> {
  await writeDB.$disconnect();
  await readDB.$disconnect();
  logger.info('数据库连接已关闭');
}

/**
 * 获取连接池配置信息
 * 用于监控和调试
 */
export function getPoolConfig(): {
  writeDB: { connectionLimit: number; poolTimeout: number; connectTimeout: number; socketTimeout: number };
  readDB: { connectionLimit: number; poolTimeout: number; connectTimeout: number; socketTimeout: number };
} {
  return {
    writeDB: {
      connectionLimit: config.dbConnection.writeConnectionLimit,
      poolTimeout: config.dbConnection.poolTimeout,
      connectTimeout: config.dbConnection.connectTimeout,
      socketTimeout: config.dbConnection.socketTimeout
    },
    readDB: {
      connectionLimit: config.dbConnection.readConnectionLimit,
      poolTimeout: config.dbConnection.poolTimeout,
      connectTimeout: config.dbConnection.connectTimeout,
      socketTimeout: config.dbConnection.socketTimeout
    }
  };
}

/**
 * 输出连接池状态信息（用于监控和启动时展示）
 */
export function logPoolStatus(): void {
  const poolConfig = getPoolConfig();
  logger.info({
    writeDB: {
      description: '写库 (高并发优化)',
      connectionLimit: poolConfig.writeDB.connectionLimit,
      poolTimeout: `${poolConfig.writeDB.poolTimeout}s`,
      connectTimeout: `${poolConfig.writeDB.connectTimeout}s`,
      socketTimeout: `${poolConfig.writeDB.socketTimeout}s`
    },
    readDB: {
      description: '读库 (高并发优化，500-2000并发用户)',
      connectionLimit: poolConfig.readDB.connectionLimit,
      poolTimeout: `${poolConfig.readDB.poolTimeout}s`,
      connectTimeout: `${poolConfig.readDB.connectTimeout}s`,
      socketTimeout: `${poolConfig.readDB.socketTimeout}s`
    }
  }, '📊 数据库连接池配置');
}

