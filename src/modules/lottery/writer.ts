import { LotteryData, BaseLotteryData } from '../../types';
import { writeDB } from '../../database/client';
import { logger } from '../../libs/logger';
import { acquireLock, releaseLock } from '../cache/lock';
import { isProcessed, markProcessed, setLastIssue } from '../cache/deduplication';
import { validateLotteryData } from './validator';
import { ErrorCode, LotteryError } from '../../config/error-codes';
import { EventEmitter } from 'events';
import { withRetry } from '../../database/operations';
import { backupToLocalJson } from '../../services/json-fallback';
import { getCurrentTimeString, parseBeijingTimeString, formatDateTime } from '../../helpers/datetime';
import { analyzeFullLotteryData } from '../../helpers/lottery-analyzer';
import { issueTracker } from './issue-tracker';

/**
 * 彩票数据写入器
 * 
 * 负责处理彩票开奖数据的完整写入流程：
 * - 去重检查（防止重复处理）
 * - 分布式锁（防止并发冲突）
 * - 数据校验（确保数据准确性）
 * - 数据库写入（带重试机制）
 * - 统计更新（非阻塞）
 * - 事件通知（触发下游处理）
 * 
 * 设计特点：
 * - 幂等性：同一期号多次写入不会产生副作用
 * - 高并发：支持多数据源并发写入
 * - 容错性：单个步骤失败不影响整体
 * 
 * @example
 * ```typescript
 * const writer = new LotteryWriter();
 * writer.on('dataWritten', (data) => {
 *   console.log('数据已写入:', data.qihao);
 * });
 * await writer.processLotteryData(lotteryData);
 * ```
 */
export class LotteryWriter extends EventEmitter {
  /**
   * 处理开奖数据（核心写入逻辑）
   * 
   * 优化流程：
   * 1. 内存期号检查（毫秒级，避免Redis竞争）
   * 2. Redis去重检查（仅新期号）
   * 3. 分布式锁（仅新期号）
   * 4. 数据校验和写入
   * 
   * 性能优化：
   * - 7个数据源抓取相同期号时，只有第一个会进入Redis操作
   * - 其他6个在内存层面就被过滤，避免Redis压力
   * - 大幅减少"获取锁失败"和"检查期号失败"的日志
   * 
   * @param data 待处理的彩票数据（基础数据，预计算属性将在处理中添加）
   * @throws {LotteryError} 当数据库写入失败时抛出
   */
  async processLotteryData(data: BaseLotteryData): Promise<void> {
    const startTime = Date.now();
    
    try {
      // 第一层过滤：内存期号检查（最快，无IO）
      if (!issueTracker.isNewIssue(data.qihao)) {
        // 不是新期号，直接返回，不产生任何日志
        return;
      }

      // 第二层过滤：Redis去重检查（快速，但有IO）
      if (await this.shouldSkipProcessing(data.qihao)) {
        return;
      }

      // 第三层保护：分布式锁（防止并发写入）
      const lockAcquired = await acquireLock(data.qihao);
      if (!lockAcquired) {
        return;
      }

      try {
        await this.processDataWithLock(data);
      } finally {
        await releaseLock(data.qihao);
      }

    } catch (error: any) {
      await this.handleProcessingError(error, data, startTime);
    }
  }

  /**
   * 检查是否应跳过处理
   * @param qihao 期号
   * @returns 如果已处理返回true，否则返回false
   */
  private async shouldSkipProcessing(qihao: string): Promise<boolean> {
    return await isProcessed(qihao);
  }

  /**
   * 在持有锁的情况下处理数据
   * 
   * 完整流程：
   * 1. 数据校验
   * 2. 并发预计算属性（新增）
   * 3. 写入数据库（包含预计算字段）
   * 4. 更新统计和遗漏数据
   * 
   * @param data 彩票数据（基础数据）
   */
  private async processDataWithLock(data: BaseLotteryData): Promise<void> {
    if (await isProcessed(data.qihao)) {
      return;
    }

    // 数据校验
    const validationResult = await validateLotteryData(data as any);
    
    if (!validationResult.valid) {
      logger.warn({ 
        qihao: data.qihao, 
        source: data.source, 
        error: validationResult.error 
      }, '数据校验失败');
      throw new Error(validationResult.error);
    }
    
    // 并发预计算属性（在写入前计算，避免后续重复判断）
    const analysis = analyzeFullLotteryData(data.opennum, data.sum_value);
    
    // 扩展数据对象，添加预计算属性
    const enrichedData: LotteryData = {
      ...data,
      is_da: analysis.sum.isDa,
      is_xiao: analysis.sum.isXiao,
      is_dan: analysis.sum.isDan,
      is_shuang: analysis.sum.isShuang,
      is_jida: analysis.sum.isJiDa,
      is_jixiao: analysis.sum.isJiXiao,
      combination: analysis.sum.combination,
      is_baozi: analysis.pattern.isBaozi,
      is_duizi: analysis.pattern.isDuizi,
      is_shunzi: analysis.pattern.isShunzi,
      is_zaliu: analysis.pattern.isZaliu,
      is_xiaobian: analysis.sum.isXiaoBian,
      is_zhong: analysis.sum.isZhong,
      is_dabian: analysis.sum.isDaBian,
      is_bian: analysis.sum.isBian,
      is_long: analysis.longHuHe.isLong,
      is_hu: analysis.longHuHe.isHu,
      is_he: analysis.longHuHe.isHe
    };
    
    // 使用扩展后的数据执行后续流程
    await this.writeToDatabase(enrichedData);
    await this.logSuccessfulWrite(enrichedData);
    await this.updateStatistics(enrichedData);
    await this.updateOmissionData(enrichedData);
    await this.finalizeProcessing(enrichedData);
  }


  /**
   * 写入数据库（包含预计算字段）
   * 
   * 时间处理策略（简化版）：
   * - 数据源返回北京时间字符串，直接解析为Date对象
   * - Prisma连接设置为timezone=Asia/Shanghai，与数据库时区一致
   * - 整个系统全部使用北京时间，无任何转换
   * 
   * 并发安全策略：
   * - 使用 upsert 处理数据写入
   * - 捕获 P2002 唯一键冲突，视为数据已存在（幂等性保证）
   * - 结合 Redis 分布式锁，双重防护并发写入
   * 
   * @param data 彩票数据（包含预计算属性）
   */
  private async writeToDatabase(data: LotteryData): Promise<void> {
    const opentime = parseBeijingTimeString(data.opentime);
    const now = new Date(); // 当前系统时间即为北京时间

    try {
      await withRetry(
        async () => await writeDB.latest_lottery_data.upsert({
          where: { qihao: data.qihao },
          create: {
            qihao: data.qihao,
            opentime: opentime,
            opennum: data.opennum,
            sum_value: data.sum_value,
            source: data.source,
            // 预计算字段
            is_da: data.is_da,
            is_xiao: data.is_xiao,
            is_dan: data.is_dan,
            is_shuang: data.is_shuang,
            is_jida: data.is_jida,
            is_jixiao: data.is_jixiao,
            combination: data.combination,
            is_baozi: data.is_baozi,
            is_duizi: data.is_duizi,
            is_shunzi: data.is_shunzi,
            is_zaliu: data.is_zaliu,
            is_xiaobian: data.is_xiaobian,
            is_zhong: data.is_zhong,
            is_dabian: data.is_dabian,
            is_bian: data.is_bian,
            is_long: data.is_long,
            is_hu: data.is_hu,
            is_he: data.is_he,
            // 时间字段
            created_at: now,
            updated_at: now
          },
          update: {}
        }),
        { operation: '写入主数据', maxAttempts: 3 }
      );
    } catch (error: any) {
      // P2002: 唯一键冲突 - 数据已存在，这是正常情况（幂等性）
      // 在高并发场景下，即使有分布式锁，upsert 仍可能遇到竞态条件
      // 此时不应抛出错误，而是静默处理，确保流程继续
      if (error.code === 'P2002') {
        logger.debug({ 
          qihao: data.qihao, 
          source: data.source 
        }, '数据已存在（并发写入检测），跳过本次写入');
        return; // 静默返回，不抛出错误
      }
      // 其他错误继续抛出
      throw error;
    }
  }

  /**
   * 记录成功写入日志
   * @param data 彩票数据
   */
  private async logSuccessfulWrite(data: LotteryData): Promise<void> {
    const timeDisplay = this.formatTimeDisplay(data.opentime);
    const sumDisplay = String(data.sum_value).padStart(2, '0');
    const currentTime = getCurrentTimeString();

    logger.info(`[新数据] ${currentTime} | 期号: ${data.qihao} | 号码: ${data.opennum} | 和值: ${sumDisplay} | 时间: ${timeDisplay}`);
  }

  /**
   * 格式化时间显示（移除年份）
   * 复用统一的时间格式化工具
   * @param opentime 开奖时间
   * @returns 格式化后的时间字符串
   */
  private formatTimeDisplay(opentime: string): string {
    const date = parseBeijingTimeString(opentime);
    return formatDateTime(date, false);
  }

  /**
   * 更新统计信息
   * 
   * 该操作失败不会阻塞主流程
   * 传递完整的LotteryData（包含预计算属性）
   * 
   * @param data 彩票数据（包含预计算属性）
   */
  private async updateStatistics(data: LotteryData): Promise<void> {
    try {
      const { updateTodayStatistics } = await import('../../services/daily-stats');
      await updateTodayStatistics(data);
    } catch (error: any) {
      logger.warn({ 
        error: error.message, 
        qihao: data.qihao 
      }, '更新统计失败，不影响主流程');
    }
  }

  /**
   * 更新遗漏数据
   * 
   * 该操作失败不会阻塞主流程
   * 传递完整的LotteryData（包含预计算属性）
   * 
   * @param data 彩票数据（包含预计算属性）
   */
  private async updateOmissionData(data: LotteryData): Promise<void> {
    try {
      const { updateOmissionData } = await import('../../services/omission-data');
      await updateOmissionData(data);
    } catch (error: any) {
      logger.warn({ 
        error: error.message, 
        qihao: data.qihao 
      }, '更新遗漏数据失败，不影响主流程');
    }
  }

  /**
   * 完成处理流程
   * 
   * 标记数据已处理并触发相关事件
   * 同时备份到本地JSON作为降级方案
   * 
   * @param data 彩票数据
   */
  private async finalizeProcessing(data: LotteryData): Promise<void> {
    await markProcessed(data.qihao);
    await setLastIssue(data.qihao);
    
    // 更新内存中的最新期号（关键优化）
    issueTracker.updateLatestIssue(data.qihao);
    
    // 备份到本地JSON（异步，不阻塞主流程）
    backupToLocalJson(data).catch(err => {
      logger.warn({ error: err, qihao: data.qihao }, '本地备份失败');
    });
    
    this.emit('dataWritten', data);
  }

  /**
   * 处理错误
   * @param error 错误对象
   * @param data 彩票数据（基础数据）
   * @param startTime 开始时间
   */
  private async handleProcessingError(error: any, data: BaseLotteryData, startTime: number): Promise<void> {
    const elapsed = Date.now() - startTime;

    // P2002 错误已在 writeToDatabase 中处理，不应该传播到这里
    // 但为了防御性编程，仍然保留这个检查
    if (this.isDuplicateKeyError(error)) {
      await this.handleDuplicateKeyError(error, data);
      return;
    }

    this.logProcessingError(error, data, elapsed);
    throw new LotteryError(
      ErrorCode.DB_WRITE_FAILED,
      `写入数据失败: ${error.message}`,
      { qihao: data.qihao, source: data.source }
    );
  }

  /**
   * 检查是否为重复键错误
   * @param error 错误对象
   * @returns 是否为重复键错误
   */
  private isDuplicateKeyError(error: any): boolean {
    return error.code === 'P2002';
  }

  /**
   * 处理重复键错误（防御性处理，正常情况下不应到达这里）
   * @param _error 错误对象（未使用，保留用于接口一致性）
   * @param data 彩票数据（基础数据）
   */
  private async handleDuplicateKeyError(_error: any, data: BaseLotteryData): Promise<void> {
    logger.debug({ 
      qihao: data.qihao, 
      source: data.source 
    }, 'P2002错误已在数据库写入层处理');
    await markProcessed(data.qihao);
  }

  /**
   * 记录处理错误日志
   * @param error 错误对象
   * @param data 彩票数据（基础数据）
   * @param elapsed 耗时（毫秒）
   */
  private logProcessingError(error: any, data: BaseLotteryData, elapsed: number): void {
    logger.error({
      error: error.message,
      stack: error.stack,
      code: error.code,
      qihao: data.qihao,
      source: data.source,
      elapsed
    }, '❌ 写入数据失败');
  }
}

