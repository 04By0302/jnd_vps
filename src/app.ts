import { logger } from './libs/logger';
import { getRedisClient, closeRedis, startRedisHealthCheck } from './libs/redis';
import { initializeDatabaseConnections, closeDatabaseConnections, logPoolStatus } from './database/client';
import { FetcherManager } from './modules/fetcher';
import { LotteryWriter } from './modules/lottery/writer';
import { generateAllJson, ensureOutputDirectory } from './services/json-output';
import { PredictionManager } from './modules/prediction/manager';
import { LotteryData } from './types';
import { WebServer } from './server';
import { config } from './config';
import { issueTracker } from './modules/lottery/issue-tracker';

/**
 * 应用程序主类
 * 
 * 负责整个系统的初始化、启动和优雅关闭
 * 
 * 核心功能：
 * - 初始化所有基础设施（Redis、数据库、Web服务器）
 * - 管理数据抓取器的生命周期
 * - 协调数据流（抓取 -> 处理 -> 存储 -> 输出）
 * - 处理进程信号和异常
 * - 优雅关闭所有连接和服务
 * 
 * 架构设计：
 * - 事件驱动：使用EventEmitter实现模块间解耦
 * - 并发抓取：多数据源并行工作，任一成功即可
 * - 容错处理：单个组件失败不影响整体运行
 * - 资源管理：统一管理所有外部连接的生命周期
 * 
 * 启动流程：
 * 1. 连接验证（Redis、数据库）
 * 2. 初始化输出（确保目录和文件存在）
 * 3. 设置事件监听（数据流管道）
 * 4. 启动抓取器和Web服务器
 * 5. 设置信号处理（优雅关闭）
 */
class Application {
  private fetcherManager: FetcherManager;
  private lotteryWriter: LotteryWriter;
  private predictionManager: PredictionManager;
  private webServer?: WebServer;
  private isShuttingDown = false;

  /**
   * 创建应用实例
   * 初始化抓取管理器、数据写入器和预测管理器
   */
  constructor() {
    this.fetcherManager = new FetcherManager();
    this.lotteryWriter = new LotteryWriter();
    this.predictionManager = new PredictionManager();
  }

  /**
   * 启动应用
   * 
   * 按顺序执行以下启动步骤：
   * 1. 验证外部依赖连接（Redis、数据库）
   * 2. 初始化输出系统（目录、JSON文件）
   * 3. 建立数据流管道（抓取 -> 处理 -> 输出）
   * 4. 启动服务（抓取器、Web服务器）
   * 5. 配置进程管理（信号处理、异常捕获）
   * 
   * @throws {Error} 当关键依赖（Redis、数据库）连接失败时
   */
  async start(): Promise<void> {
    try {
      this.printStartupBanner();
      
      await this.initializeInfrastructure();
      await this.initializeOutputSystem();
      this.setupDataPipeline();
      this.startServices();
      this.setupSignalHandlers();
      
      this.printReadyMessage();
    } catch (error: any) {
      // 详细的错误信息输出
      logger.error({ 
        message: error?.message || '未知错误',
        code: error?.code,
        name: error?.name,
        stack: error?.stack,
        details: error
      }, '应用启动失败');
      
      // 控制台输出更友好的错误提示
      console.error('\n[失败] 启动失败原因:');
      if (error?.message) {
        console.error(`   ${error.message}`);
      }
      if (error?.code) {
        console.error(`   错误代码: ${error.code}`);
      }
      
      await this.shutdown();
      process.exit(1);
    }
  }

  /**
   * 打印启动横幅
   */
  private printStartupBanner(): void {
    console.log('\n' + '='.repeat(60));
    console.log('   [系统] 加拿大28开奖数据抓取系统');
    console.log('='.repeat(60));
  }

  /**
   * 初始化基础设施（Redis、数据库、期号追踪器、本地缓存）
   */
  private async initializeInfrastructure(): Promise<void> {
    await this.initializeLocalCache();
    await this.connectRedis();
    await this.connectDatabase();
    await this.initializeIssueTracker();
    logPoolStatus();
  }

  /**
   * 初始化本地缓存（优先级最高，作为降级方案）
   */
  private async initializeLocalCache(): Promise<void> {
    try {
      console.log('   [初始化] 正在加载本地缓存...');
      const { initializeCache } = await import('./modules/cache/deduplication');
      initializeCache();
      console.log('   [成功] 本地缓存已加载');
    } catch (error: any) {
      console.log('   [警告] 本地缓存加载失败，将使用空缓存');
      logger.warn({ error: error.message }, '本地缓存加载失败');
    }
  }

  /**
   * 连接Redis
   */
  private async connectRedis(): Promise<void> {
    try {
      console.log('   [连接] 正在连接Redis...');
      console.log(`      地址: ${config.redis.host}:${config.redis.port}`);
      console.log(`      连接超时: ${config.redis.connectTimeout}ms`);
      console.log(`      命令超时: ${config.redis.commandTimeout}ms`);
      console.log(`      Keepalive: ${config.redis.keepAlive}ms`);
      
      const redis = getRedisClient();
      const startTime = Date.now();
      await redis.ping();
      const connectTime = Date.now() - startTime;
      
      console.log(`   [成功] Redis连接成功 (耗时: ${connectTime}ms)`);
      
      // 启动定期健康检查
      startRedisHealthCheck();
    } catch (error: any) {
      console.error('   [失败] Redis连接失败');
      console.error(`      错误类型: ${error.code || error.name || '未知'}`);
      console.error(`      错误信息: ${error.message || '未知错误'}`);
      throw new Error(`Redis连接失败: ${error.message || '未知错误'} (Host: ${config.redis.host}:${config.redis.port})`);
    }
  }

  /**
   * 连接数据库
   */
  private async connectDatabase(): Promise<void> {
    try {
      console.log('   [连接] 正在连接数据库...');
      await initializeDatabaseConnections();
      console.log('   [成功] 数据库连接成功');
    } catch (error: any) {
      console.error('   [失败] 数据库连接失败');
      throw new Error(`数据库连接失败: ${error.message || '未知错误'}`);
    }
  }

  /**
   * 初始化期号追踪器
   */
  private async initializeIssueTracker(): Promise<void> {
    try {
      console.log('   [初始化] 正在初始化期号追踪器...');
      await issueTracker.initialize();
      const latestIssue = issueTracker.getLatestIssue();
      console.log(`   [成功] 期号追踪器已初始化 (最新期号: ${latestIssue})`);
    } catch (error: any) {
      // 期号追踪器初始化失败不影响系统启动
      console.log('   [警告] 期号追踪器初始化失败，将使用降级方案');
      logger.warn({ error: error.message }, '期号追踪器初始化失败');
    }
  }

  /**
   * 初始化输出系统
   */
  private async initializeOutputSystem(): Promise<void> {
    await ensureOutputDirectory();
    try {
      await generateAllJson();
      console.log('   [成功] JSON文件已初始化');
    } catch (error) {
      logger.warn({ error }, 'JSON文件初始化失败（可能数据为空）');
    }
    
    // 初始化胜率缓存
    try {
      const { updateWinrateCache } = await import('./services/predict-output');
      await updateWinrateCache();
      console.log('   [成功] 胜率缓存已初始化');
    } catch (error) {
      logger.warn({ error }, '胜率缓存初始化失败（可能数据为空）');
    }
  }

  /**
   * 设置数据处理管道
   * 
   * 建立事件驱动的数据流：
   * 抓取器 --[data]--> 写入器 --[dataWritten]--> 统一处理器
   * 
   * 优化说明：
   * - 合并重复的事件监听器，避免同一事件被处理多次
   * - 统一的 dataWritten 处理器，按顺序执行所有后续操作
   */
  private setupDataPipeline(): void {
    this.setupDataHandler();
    this.setupDataWrittenHandler(); // 合并后的统一处理器
    this.setupPredictionCompletedHandler(); // 预测完成处理器
  }

  /**
   * 设置数据处理器
   * 监听抓取器的数据事件，将数据传递给写入器
   */
  private setupDataHandler(): void {
    this.fetcherManager.on('data', async (data: LotteryData) => {
      try {
        await this.lotteryWriter.processLotteryData(data);
      } catch (error) {
        logger.error(`处理数据失败 期号:${data.qihao} 错误:${error}`);
      }
    });
  }

  /**
   * 设置数据写入完成处理器（统一处理）
   * 
   * 监听数据写入完成事件，按顺序执行：
   * 1. 生成JSON文件（kj、yl、yk）
   * 2. 清除所有相关缓存
   * 3. 更新历史预测结果
   * 4. 触发新一期AI预测
   * 
   * 设计说明：
   * - 合并原来的 setupJsonUpdateHandler 和 setupPredictionHandler
   * - 避免同一事件被监听两次
   * - 统一的错误处理和日志记录
   */
  private setupDataWrittenHandler(): void {
    this.lotteryWriter.on('dataWritten', async (data: LotteryData) => {
      try {
        // 1. 生成JSON文件（降级备用）
        await generateAllJson();
        
        // 2. 清除开奖数据相关缓存（不含预测缓存，避免时序竞争）
        const { clearDataCachesExceptPredict } = await import('./services/cache-manager');
        await clearDataCachesExceptPredict();
        
        // 3. 更新历史预测的开奖结果
        await this.predictionManager.updateHistoryPredictions(
          data.qihao,
          data.opennum,
          data.sum_value
        );

        // 4. 触发新一期的AI预测（异步执行，不阻塞）
        // 注意：不在这里生成预测JSON，等预测完成后再生成
        // 预测缓存在预测完成后清除，避免缓存旧预测
        this.predictionManager.triggerPrediction(data.qihao).catch(err => {
          logger.error(`AI预测触发失败 期号:${data.qihao} 错误:${err}`);
        });
      } catch (error) {
        logger.error(`数据写入后处理失败 期号:${data.qihao} 错误:${error}`);
      }
    });
  }

  /**
   * 设置单个预测完成处理器（流式处理）
   * 
   * 每个预测类型完成后立即更新，不等待其他类型
   * 实现最快的用户响应速度
   */
  private setupPredictionCompletedHandler(): void {
    // 监听单个预测完成事件
    this.predictionManager.on('singlePredictionCompleted', async (event: any) => {
      try {
        const { qihao, predictType, predictValue, duration } = event;
        
        logger.info(`[AI预测] 期号:${qihao} 类型:${predictType} 值:${predictValue} 耗时:${duration}秒`);
        
        // 1. 生成该类型的JSON文件
        const { generatePredictJsonByType } = await import('./services/predict-output');
        await generatePredictJsonByType(predictType);
        
        // 2. 清除该类型的Redis缓存
        const { clearPredictCache } = await import('./services/predict-cache');
        await clearPredictCache(predictType);
        
        logger.debug(`预测API已更新 类型:${predictType} 期号:${qihao}`);
      } catch (error) {
        logger.error(`预测API更新失败 类型:${event.predictType} 期号:${event.qihao} 错误:${error}`);
      }
    });

    // 监听所有预测完成事件（用于更新胜率缓存）
    this.predictionManager.on('allPredictionsCompleted', async (event: any) => {
      try {
        logger.debug(`所有预测已完成，更新胜率缓存 期号:${event.qihao}`);
        
        // 更新胜率缓存
        const { updateWinrateCache } = await import('./services/predict-output');
        await updateWinrateCache();
        
        logger.debug(`胜率缓存已更新 期号:${event.qihao}`);
      } catch (error) {
        logger.warn({ error, qihao: event.qihao }, '胜率缓存更新失败（非致命）');
      }
    });
  }

  /**
   * 启动服务（抓取器、Web服务器）
   */
  private startServices(): void {
    this.startFetchers();
    this.startWebServer();
  }

  /**
   * 启动所有数据源抓取器
   */
  private startFetchers(): void {
    this.fetcherManager.startAll();
    const status = this.fetcherManager.getStatus();
    console.log(`   [成功] 已启动 ${status.length} 个数据源抓取器`);
  }

  /**
   * 启动Web服务器
   */
  private startWebServer(): void {
    this.webServer = new WebServer(9797);
    this.webServer.start();
  }


  /**
   * 打印就绪消息
   */
  private printReadyMessage(): void {
    console.log('='.repeat(60));
    console.log('   [就绪] 系统运行中，等待新开奖数据...');
    console.log('='.repeat(60) + '\n');
  }

  /**
   * 设置进程信号处理
   * 
   * 注册各种进程信号和异常的处理器：
   * - SIGINT: 用户中断（Ctrl+C）
   * - SIGTERM: 终止信号（系统关闭、Docker stop等）
   * - uncaughtException: 未捕获的同步异常
   * - unhandledRejection: 未处理的Promise拒绝
   * 
   * 确保所有退出场景都能触发优雅关闭流程
   */
  private setupSignalHandlers(): void {
    process.on('SIGINT', async () => {
      logger.info('收到SIGINT信号（用户中断）');
      await this.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('收到SIGTERM信号（终止请求）');
      await this.shutdown();
      process.exit(0);
    });

    process.on('uncaughtException', (error) => {
      logger.error({ error }, '未捕获的异常');
      this.shutdown().then(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error({ reason, promise }, '未处理的Promise拒绝');
    });
  }

  /**
   * 优雅关闭应用
   * 
   * 按顺序关闭所有组件和连接：
   * 1. 停止数据抓取（防止新数据进入）
   * 2. 关闭Redis连接
   * 3. 关闭数据库连接
   * 
   * 使用标志位防止重复关闭
   * 即使关闭过程出错也会继续执行，确保所有资源都被释放
   */
  private async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info('开始优雅关闭...');

    try {
      await this.stopFetchers();
      await this.closeRedisConnection();
      await this.closeDatabaseConnection();

      this.printShutdownMessage();
    } catch (error) {
      logger.error({ error }, '关闭过程中发生错误');
    }
  }

  /**
   * 停止所有抓取器
   */
  private async stopFetchers(): Promise<void> {
    logger.info('停止抓取器...');
    this.fetcherManager.stopAll();
  }

  /**
   * 关闭Redis连接
   */
  private async closeRedisConnection(): Promise<void> {
    logger.info('关闭Redis连接...');
    await closeRedis();
  }

  /**
   * 关闭数据库连接
   */
  private async closeDatabaseConnection(): Promise<void> {
    logger.info('关闭数据库连接...');
    await closeDatabaseConnections();
  }

  /**
   * 打印关闭消息
   */
  private printShutdownMessage(): void {
    logger.info('========================================');
    logger.info('   系统已安全关闭');
    logger.info('========================================');
  }
}

// 启动应用
const app = new Application();
app.start().catch((error: any) => {
      logger.error({ 
        message: error?.message || '未知错误',
        code: error?.code,
        name: error?.name,
        stack: error?.stack
      }, '应用启动失败（顶层捕获）');
      console.error('\n[失败] 应用启动失败（顶层捕获）:', error?.message || error);
  process.exit(1);
});

