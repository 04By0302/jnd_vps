import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config();

// 导出统计类型配置
export * from './stat-types';

export const config = {
  // 主库配置（写）
  writeDB: {
    host: process.env.WRITE_DB_HOST || 'localhost',
    port: parseInt(process.env.WRITE_DB_PORT || '3306'),
    database: process.env.WRITE_DB_NAME || 'new_api',
    user: process.env.WRITE_DB_USER || 'root',
    password: process.env.WRITE_DB_PASSWORD || ''
  },

  // 从库配置（读）
  readDB: {
    host: process.env.READ_DB_HOST || 'localhost',
    port: parseInt(process.env.READ_DB_PORT || '3306'),
    database: process.env.READ_DB_NAME || 'new_api',
    user: process.env.READ_DB_USER || 'root',
    password: process.env.READ_DB_PASSWORD || ''
  },

  // 数据库连接优化参数（公网访问优化 + 连接池管理）
  dbConnection: {
    // 连接超时配置（秒）
    connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '60'),
    socketTimeout: parseInt(process.env.DB_SOCKET_TIMEOUT || '120'),
    poolTimeout: parseInt(process.env.DB_POOL_TIMEOUT || '60'),
    
    // 连接池大小
    writeConnectionLimit: parseInt(process.env.WRITE_DB_CONNECTION_LIMIT || '25'),
    readConnectionLimit: parseInt(process.env.READ_DB_CONNECTION_LIMIT || '100'),
    
    // 连接生命周期管理（秒）
    idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || '600'),        // 空闲连接超时10分钟
    maxLifetime: parseInt(process.env.DB_MAX_LIFETIME || '1800'),       // 连接最大生命周期30分钟
    evictionInterval: parseInt(process.env.DB_EVICTION_INTERVAL || '60') // 空闲检查间隔60秒
  },

  // Redis配置（跨云公网优化）
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    // 连接超时配置（毫秒）
    connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '30000'),  // 连接超时30秒
    commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT || '15000'),  // 命令超时15秒
    keepAlive: parseInt(process.env.REDIS_KEEPALIVE || '30000')              // TCP Keepalive 30秒
  },

  // 应用配置
  app: {
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info'
  },

  // 输出路径
  output: {
    dir: process.env.OUTPUT_DIR || './output',
    kjFile: 'kj.json',
    ylFile: 'yl.json',
    ykFile: 'yk.json',
    dsFile: 'ds.json',
    dxFile: 'dx.json',
    zhFile: 'zh.json',
    shaFile: 'sha.json'
  },

  // 获取完整输出路径
  getOutputPath(filename: string): string {
    return path.resolve(this.output.dir, filename);
  },

  // 获取Prisma主库连接字符串（带MySQL标准参数 + Prisma连接池参数）
  getWriteDBUrl(): string {
    const { host, port, database, user, password } = this.writeDB;
    const { connectTimeout, socketTimeout, poolTimeout, writeConnectionLimit, idleTimeout, maxLifetime } = this.dbConnection;
    
    // MySQL标准连接参数 + Prisma连接池参数
    const params = new URLSearchParams({
      // MySQL连接参数
      connect_timeout: String(connectTimeout),
      read_timeout: String(socketTimeout),
      write_timeout: String(socketTimeout),
      timezone: '+08:00',
      charset: 'utf8mb4',
      ssl_mode: 'DISABLED',
      // Prisma连接池参数
      connection_limit: String(writeConnectionLimit),
      pool_timeout: String(poolTimeout),
      // 连接生命周期管理
      idle_timeout: String(idleTimeout),
      max_lifetime: String(maxLifetime)
    });
    
    return `mysql://${user}:${password}@${host}:${port}/${database}?${params.toString()}`;
  },

  // 获取Prisma从库连接字符串（带MySQL标准参数 + Prisma连接池参数）
  getReadDBUrl(): string {
    const { host, port, database, user, password } = this.readDB;
    const { connectTimeout, socketTimeout, poolTimeout, readConnectionLimit, idleTimeout, maxLifetime } = this.dbConnection;
    
    // MySQL标准连接参数 + Prisma连接池参数
    const params = new URLSearchParams({
      // MySQL连接参数
      connect_timeout: String(connectTimeout),
      read_timeout: String(socketTimeout),
      write_timeout: String(socketTimeout),
      timezone: '+08:00',
      charset: 'utf8mb4',
      ssl_mode: 'DISABLED',
      // Prisma连接池参数
      connection_limit: String(readConnectionLimit),
      pool_timeout: String(poolTimeout),
      // 连接生命周期管理
      idle_timeout: String(idleTimeout),
      max_lifetime: String(maxLifetime)
    });
    
    return `mysql://${user}:${password}@${host}:${port}/${database}?${params.toString()}`;
  },

  // 缓存TTL配置
  cache: {
    lockTTL: parseInt(process.env.CACHE_LOCK_TTL || '3'),
    seenTTL: parseInt(process.env.CACHE_SEEN_TTL || '3600'),
    dataTTL: parseInt(process.env.CACHE_DATA_TTL || '180'),
    winrateTTL: parseInt(process.env.CACHE_WINRATE_TTL || '300')
  },
  
  // 重试配置
  retry: {
    maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS || '3'),
    initialDelay: parseInt(process.env.RETRY_INITIAL_DELAY || '1000'),
    maxDelay: parseInt(process.env.RETRY_MAX_DELAY || '10000')
  },
  
  // AI预测配置
  prediction: {
    groupDelay: parseInt(process.env.PREDICT_GROUP_DELAY || '2000'),
    lockTTL: parseInt(process.env.PREDICT_LOCK_TTL || '300')
  },
  
  // 限流配置
  rateLimit: {
    apiMax: parseInt(process.env.RATE_LIMIT_API_MAX || '100'),  // 10秒内最多100次
    strictMax: parseInt(process.env.RATE_LIMIT_STRICT_MAX || '30'),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '10000'),  // 10秒窗口
    blacklistDuration: parseInt(process.env.RATE_LIMIT_BLACKLIST_DURATION || '1800')  // 封禁30分钟
  },
  
  
  // 性能阈值配置
  performance: {
    apiMaxLatency: parseInt(process.env.PERF_API_MAX_LATENCY || '50'),
    fetcherMaxDelay: parseInt(process.env.PERF_FETCHER_MAX_DELAY || '2000'),
    dbMaxQueryTime: parseInt(process.env.PERF_DB_MAX_QUERY_TIME || '20')
  }
};






