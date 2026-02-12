/**
 * 并发控制工具
 * 
 * 提供高性能的并发控制机制，优化系统稳定性
 */

import { logger } from '../libs/logger';

/**
 * 并发队列配置
 */
interface QueueConfig {
  concurrency: number;  // 并发数
  timeout?: number;     // 超时时间（毫秒）
  retryAttempts?: number;  // 重试次数
  retryDelay?: number;  // 重试延迟（毫秒）
}

/**
 * 任务结果
 */
interface TaskResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  duration: number;
}

/**
 * 并发队列
 * 
 * 特性：
 * - 限制并发数，防止资源耗尽
 * - 自动重试失败任务
 * - 超时控制
 * - 性能统计
 */
export class ConcurrencyQueue {
  private queue: Array<() => Promise<any>> = [];
  private running = 0;
  private config: Required<QueueConfig>;
  private stats = {
    total: 0,
    success: 0,
    failed: 0,
    retried: 0,
    avgDuration: 0
  };

  constructor(config: QueueConfig) {
    this.config = {
      concurrency: config.concurrency,
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 2,
      retryDelay: config.retryDelay || 1000
    };
  }

  /**
   * 添加任务到队列
   */
  async add<T>(task: () => Promise<T>): Promise<TaskResult<T>> {
    return new Promise((resolve) => {
      this.queue.push(async () => {
        const result = await this.executeTask(task);
        resolve(result);
      });
      this.process();
    });
  }

  /**
   * 批量添加任务
   */
  async addBatch<T>(tasks: Array<() => Promise<T>>): Promise<Array<TaskResult<T>>> {
    const promises = tasks.map(task => this.add(task));
    return Promise.all(promises);
  }

  /**
   * 执行任务（带重试和超时）
   */
  private async executeTask<T>(
    task: () => Promise<T>,
    attempt = 1
  ): Promise<TaskResult<T>> {
    const startTime = Date.now();
    this.stats.total++;

    try {
      // 超时控制
      const result = await Promise.race([
        task(),
        this.timeoutPromise<T>(this.config.timeout)
      ]);

      const duration = Date.now() - startTime;
      this.updateStats(true, duration);

      return {
        success: true,
        data: result,
        duration
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      // 重试逻辑
      if (attempt < this.config.retryAttempts) {
        this.stats.retried++;
        logger.debug({
          attempt,
          maxAttempts: this.config.retryAttempts,
          error: error.message
        }, '任务失败，准备重试');

        await this.delay(this.config.retryDelay);
        return this.executeTask(task, attempt + 1);
      }

      this.updateStats(false, duration);

      return {
        success: false,
        error: error as Error,
        duration
      };
    }
  }

  /**
   * 处理队列
   */
  private async process(): Promise<void> {
    while (this.running < this.config.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) continue;

      this.running++;
      task().finally(() => {
        this.running--;
        this.process();
      });
    }
  }

  /**
   * 超时Promise
   */
  private timeoutPromise<T>(ms: number): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Task timeout after ${ms}ms`)), ms);
    });
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 更新统计
   */
  private updateStats(success: boolean, duration: number): void {
    if (success) {
      this.stats.success++;
    } else {
      this.stats.failed++;
    }

    // 计算平均耗时
    const total = this.stats.success + this.stats.failed;
    this.stats.avgDuration = 
      (this.stats.avgDuration * (total - 1) + duration) / total;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.total > 0 
        ? ((this.stats.success / this.stats.total) * 100).toFixed(2) + '%'
        : '0%',
      avgDuration: Math.round(this.stats.avgDuration) + 'ms'
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      retried: 0,
      avgDuration: 0
    };
  }
}

/**
 * 批量处理工具
 * 
 * 将大量数据分批处理，避免内存溢出和数据库压力
 */
export async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<R[]>,
  onProgress?: (processed: number, total: number) => void
): Promise<R[]> {
  const results: R[] = [];
  const total = items.length;

  for (let i = 0; i < total; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await processor(batch);
    results.push(...batchResults);

    if (onProgress) {
      onProgress(Math.min(i + batchSize, total), total);
    }
  }

  return results;
}

/**
 * 限流器
 * 
 * 使用令牌桶算法限制操作频率
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // 每秒补充的令牌数

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * 尝试获取令牌
   */
  async acquire(tokens = 1): Promise<boolean> {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  /**
   * 等待直到获取令牌
   */
  async waitForToken(tokens = 1): Promise<void> {
    while (!(await this.acquire(tokens))) {
      const waitTime = Math.ceil((tokens - this.tokens) / this.refillRate * 1000);
      await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 100)));
    }
  }

  /**
   * 补充令牌
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * 获取当前令牌数
   */
  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

/**
 * 创建全局并发队列实例
 */
export const globalQueue = new ConcurrencyQueue({
  concurrency: 10,
  timeout: 30000,
  retryAttempts: 2,
  retryDelay: 1000
});

/**
 * 创建数据库操作限流器
 * 限制每秒最多100次数据库操作
 */
export const dbRateLimiter = new RateLimiter(100, 100);

/**
 * 创建API请求限流器
 * 限制每秒最多50次API请求
 */
export const apiRateLimiter = new RateLimiter(50, 50);


