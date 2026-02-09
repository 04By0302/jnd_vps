import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { DataSourceConfig } from '../../types';
import { logger } from '../../libs/logger';
import { EventEmitter } from 'events';

/**
 * 基础抓取器类
 * 
 * 提供统一的数据源抓取功能，支持：
 * - 自动定时轮询
 * - SSL证书验证跳过
 * - 连接保持（keep-alive）
 * - 事件驱动的数据通知
 * 
 * @example
 * ```typescript
 * const fetcher = new BaseFetcher(config);
 * fetcher.on('data', (data) => console.log(data));
 * fetcher.start();
 * ```
 */
export class BaseFetcher extends EventEmitter {
  private axiosInstance: AxiosInstance;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * 创建抓取器实例
   * @param config 数据源配置
   */
  constructor(private config: DataSourceConfig) {
    super();
    
    this.axiosInstance = this.createAxiosInstance();
  }

  /**
   * 创建配置好的axios实例
   * @returns 配置后的axios实例
   */
  private createAxiosInstance(): AxiosInstance {
    return axios.create({
      timeout: 8000,
      headers: {
        ...this.getDefaultHeaders(),
        ...(this.config.headers || {})  // 合并自定义请求头
      },
      ...(this.config.skipSSL && {
        httpsAgent: this.createHttpsAgent()
      })
    });
  }

  /**
   * 获取默认HTTP请求头
   * @returns HTTP请求头对象
   */
  private getDefaultHeaders(): Record<string, string> {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Connection': 'keep-alive'
    };
  }

  /**
   * 创建HTTPS代理（用于跳过SSL验证）
   * @returns HTTPS代理实例
   */
  private createHttpsAgent(): https.Agent {
    return new https.Agent({
      rejectUnauthorized: false,
      keepAlive: true
    });
  }

  /**
   * 开始抓取
   * 
   * 立即执行一次抓取，然后按配置的时间间隔定时执行
   * 如果抓取器已在运行，则忽略此次调用
   */
  start(): void {
    if (this.isRunning) {
      logger.warn({ source: this.config.name }, '抓取器已在运行');
      return;
    }

    this.isRunning = true;
    this.fetch();
    this.scheduleNextFetch();
  }

  /**
   * 停止抓取
   * 
   * 清除定时器并标记抓取器为停止状态
   */
  stop(): void {
    this.clearScheduledFetch();
    this.isRunning = false;
    logger.info({ source: this.config.name }, '抓取器停止');
  }

  /**
   * 安排下次抓取
   */
  private scheduleNextFetch(): void {
    this.intervalId = setInterval(() => {
      this.fetch();
    }, this.config.interval);
  }

  /**
   * 清除已安排的抓取任务
   */
  private clearScheduledFetch(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * 执行单次抓取
   * 
   * 从配置的URL获取数据，解析后通过'data'事件发送
   * 网络错误会被静默处理（系统设计为多源并发，单源失败不影响整体）
   */
  private async fetch(): Promise<void> {
    try {
      const response = await this.axiosInstance.get(this.config.url);

      if (!this.isValidResponse(response.status)) {
        return;
      }

      const parsedData = this.parseResponse(response.data);
      
      if (parsedData) {
        this.emitData(parsedData);
      }
    } catch (error: any) {
      // 网络错误静默处理
      // 系统每1秒自动重试，5个数据源并发，任意一个成功即可
      // 无需记录每次失败
    }
  }

  /**
   * 检查响应状态是否有效
   * @param status HTTP状态码
   * @returns 是否为有效响应
   */
  private isValidResponse(status: number): boolean {
    return status === 200;
  }

  /**
   * 解析响应数据
   * @param responseData 原始响应数据
   * @returns 解析后的数据，解析失败返回null
   */
  private parseResponse(responseData: any): any {
    return this.config.parser(responseData);
  }

  /**
   * 发送数据事件
   * @param data 要发送的数据
   */
  private emitData(data: any): void {
    this.emit('data', data);
  }

  /**
   * 获取抓取器状态
   * @returns 包含名称、运行状态和时间间隔的状态对象
   */
  getStatus(): { name: string; running: boolean; interval: number } {
    return {
      name: this.config.name,
      running: this.isRunning,
      interval: this.config.interval
    };
  }
}

