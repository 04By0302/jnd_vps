import { logger } from '../../libs/logger';
import { readDB } from '../../database/client';

/**
 * 期号追踪器
 * 
 * 在内存中维护最新期号，用于快速判断新数据
 * 避免每次都查询Redis或数据库
 * 
 * 设计特点：
 * - 内存缓存：毫秒级响应
 * - 自动初始化：启动时从数据库加载
 * - 线程安全：使用简单的比较操作
 * - 降级方案：初始化失败不影响系统启动
 * 
 * 使用场景：
 * - 抓取器解析后立即判断是否为新数据
 * - 避免7个数据源同时竞争Redis锁
 * - 减少Redis压力，提高响应速度
 */
class IssueTracker {
  private latestIssue: string = '0';
  private isInitialized: boolean = false;

  /**
   * 初始化期号追踪器
   * 从数据库加载最新期号
   */
  async initialize(): Promise<void> {
    try {
      const latest = await readDB.latest_lottery_data.findFirst({
        orderBy: { opentime: 'desc' },
        select: { qihao: true }
      });

      if (latest) {
        this.latestIssue = latest.qihao;
        this.isInitialized = true;
        logger.info({ latestIssue: this.latestIssue }, '期号追踪器已初始化');
      } else {
        // 数据库为空，使用默认值
        this.latestIssue = '0';
        this.isInitialized = true;
        logger.warn('数据库为空，期号追踪器使用默认值');
      }
    } catch (error: any) {
      // 初始化失败不影响系统启动，使用默认值
      this.latestIssue = '0';
      this.isInitialized = true;
      logger.warn({ 
        errorMessage: error?.message || String(error),
        errorCode: error?.code 
      }, '期号追踪器初始化失败，使用默认值');
    }
  }

  /**
   * 检查是否为新期号
   * 
   * @param qihao 待检查的期号
   * @returns true=新期号，false=旧期号或相同期号
   * 
   * 判断逻辑：
   * - 期号必须大于当前最新期号
   * - 使用数值比较，确保正确性
   */
  isNewIssue(qihao: string): boolean {
    if (!this.isInitialized) {
      // 未初始化时，允许所有数据通过（降级方案）
      return true;
    }

    try {
      const currentIssueNum = parseInt(this.latestIssue);
      const newIssueNum = parseInt(qihao);

      // 期号必须大于当前最新期号
      return newIssueNum > currentIssueNum;
    } catch (error) {
      // 解析失败，允许通过（降级方案）
      logger.warn({ qihao, latestIssue: this.latestIssue }, '期号解析失败');
      return true;
    }
  }

  /**
   * 更新最新期号
   * 
   * @param qihao 新的期号
   * 
   * 注意：
   * - 只在数据成功写入数据库后调用
   * - 自动检查期号是否递增
   */
  updateLatestIssue(qihao: string): void {
    try {
      const currentIssueNum = parseInt(this.latestIssue);
      const newIssueNum = parseInt(qihao);

      if (newIssueNum > currentIssueNum) {
        const oldIssue = this.latestIssue;
        this.latestIssue = qihao;
        logger.debug({ 
          oldIssue, 
          newIssue: qihao 
        }, '最新期号已更新');
      } else {
        logger.warn({ 
          currentIssue: this.latestIssue, 
          attemptIssue: qihao 
        }, '尝试更新为非递增期号，已忽略');
      }
    } catch (error) {
      logger.warn({ qihao }, '期号更新失败');
    }
  }

  /**
   * 获取当前最新期号
   * 
   * @returns 最新期号字符串
   */
  getLatestIssue(): string {
    return this.latestIssue;
  }

  /**
   * 检查是否已初始化
   * 
   * @returns 初始化状态
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * 重置追踪器（用于测试）
   */
  reset(): void {
    this.latestIssue = '0';
    this.isInitialized = false;
  }
}

// 导出单例
export const issueTracker = new IssueTracker();





