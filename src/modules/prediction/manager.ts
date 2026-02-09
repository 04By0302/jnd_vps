import { EventEmitter } from 'events';
import { logger } from '../../libs/logger';
import { getRedisClient } from '../../libs/redis';
import { readDB } from '../../database/client';
import { PredictType, CacheKeys } from '../../types';
import { callDeepSeekAPI, parsePredictValue } from '../../services/ai-predict';
import { PredictionWriter } from './writer';
import { withRetry } from '../../database/operations';

/**
 * AI预测管理器
 * 负责协调AI预测的整个流程
 */
export class PredictionManager extends EventEmitter {
  private writer: PredictionWriter;
  private isProcessing = false;
  // 追踪每期完成的预测类型数量（用于胜率更新）
  private completionTracker = new Map<string, Set<PredictType>>();

  constructor() {
    super();
    this.writer = new PredictionWriter();
  }

  /**
   * 触发预测（新开奖数据时调用）
   * 
   * 流式独立处理：4个预测类型完全并发，各自独立完成和更新
   * 优点：快的预测不等慢的，用户体验最佳
   */
  async triggerPrediction(qihao: string): Promise<void> {
    // 防止重复处理
    if (this.isProcessing) {
      return;
    }

    // 获取下一期期号
    const nextQihao = String(parseInt(qihao) + 1);

    // 使用Redis锁确保每期只预测一次
    const redis = getRedisClient();
    const lockKey = `${CacheKeys.PREDICT_LOCK}${nextQihao}`;
    const lockAcquired = await redis.set(lockKey, '1', 'EX', 300, 'NX');

    if (!lockAcquired) {
      return;
    }

    this.isProcessing = true;

    try {
      // 1. 获取历史数据
      const historyData = await this.getHistoryData();
      if (historyData.length === 0) {
        logger.warn('[预测] 历史数据为空，跳过预测');
        return;
      }

      logger.info(`[预测] 触发预测 期号:${nextQihao}`);

      // 2. 4个预测类型完全独立并发，各自处理
      const allTypes = [
        PredictType.DANSHUANG,
        PredictType.DAXIAO,
        PredictType.COMBINATION,
        PredictType.KILL
      ];

      // 触发独立预测，不等待完成
      allTypes.forEach(type => {
        this.predictSingleWithCallback(type, nextQihao, historyData)
          .catch(err => {
            logger.error(`[预测] 失败 类型:${type} 期号:${nextQihao} 错误:${err.message || err}`);
          });
      });

    } catch (error) {
      logger.error(`[预测] 触发失败 期号:${nextQihao} 错误:${error}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 获取该类型最近的预测记录（用于偏向检测）
   */
  private async getRecentPredictions(predictType: PredictType, limit: number = 10): Promise<string[]> {
    try {
      const records = await withRetry(
        async () => {
          return await readDB.ai_predictions.findMany({
            where: { predict_type: predictType.toLowerCase() },
            orderBy: { created_at: 'desc' },
            take: limit,
            select: { predict_value: true }
          });
        },
        { operation: `获取最近${limit}条${predictType}预测记录` }
      );
      
      return records.map((r: any) => r.predict_value);
    } catch (error) {
      logger.debug(`[预测] 获取历史记录失败 类型:${predictType}`);
      return [];
    }
  }

  /**
   * 单个预测（带回调）
   * 完成后立即触发独立事件
   */
  private async predictSingleWithCallback(
    predictType: PredictType,
    qihao: string,
    historyData: Array<{ 
      qihao: string; 
      opennum: string; 
      sum: number;
      opentime?: Date;
      is_da?: boolean;
      is_xiao?: boolean;
      is_dan?: boolean;
      is_shuang?: boolean;
      combination?: string;
    }>
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      // 获取最近预测记录（用于偏向检测）
      const recentPredictions = await this.getRecentPredictions(predictType, 10);
      
      // 调用AI（传递最近预测用于动态平衡）
      const aiResponse = await callDeepSeekAPI(predictType, historyData, recentPredictions);
      
      // 解析预测值
      const predictValue = parsePredictValue(predictType, aiResponse);

      // 保存到数据库
      await this.writer.savePrediction({
        qihao,
        predictType,
        predictValue
      }, true);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      // 触发单个预测完成事件
      this.emit('singlePredictionCompleted', {
        qihao,
        predictType,
        predictValue,
        duration
      });

      logger.info(`[预测] 完成 类型:${predictType} 期号:${qihao} 结果:${predictValue} 耗时:${duration}s`);

      // 追踪完成情况
      this.trackCompletion(qihao, predictType);

    } catch (error: any) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.error(`[预测] 失败 类型:${predictType} 期号:${qihao} 耗时:${duration}s 错误:${error.message || error}`);
      throw error;
    }
  }

  /**
   * 追踪预测完成情况
   * 当所有4个预测都完成时触发全部完成事件（用于胜率更新）
   */
  private trackCompletion(qihao: string, predictType: PredictType): void {
    if (!this.completionTracker.has(qihao)) {
      this.completionTracker.set(qihao, new Set());
    }

    const completed = this.completionTracker.get(qihao)!;
    completed.add(predictType);

    // 检查是否4个预测全部完成
    if (completed.size === 4) {
      // 触发全部完成事件（用于胜率更新）
      this.emit('allPredictionsCompleted', { qihao });
      
      // 清理追踪记录（保留最近10期）
      const keys = Array.from(this.completionTracker.keys());
      if (keys.length > 10) {
        const oldestKey = keys[0];
        this.completionTracker.delete(oldestKey);
      }
      
      logger.info(`[预测] 全部完成 期号:${qihao}`);
    }
  }


  /**
   * 获取历史开奖数据（用于AI分析，包含当天统计所需字段）
   */
  private async getHistoryData(): Promise<Array<{ 
    qihao: string; 
    opennum: string; 
    sum: number;
    opentime: Date;
    is_da?: boolean;
    is_xiao?: boolean;
    is_dan?: boolean;
    is_shuang?: boolean;
    combination?: string;
  }>> {
    try {
      const records = await withRetry(
        async () => {
          return await readDB.latest_lottery_data.findMany({
            orderBy: { opentime: 'desc' },
            take: 50, // 优化：减少到50期，提升查询速度
            select: {
              qihao: true,
              opennum: true,
              sum_value: true,
              opentime: true,
              is_da: true,
              is_xiao: true,
              is_dan: true,
              is_shuang: true,
              combination: true
            }
          });
        },
        { operation: '获取历史数据用于AI预测' }
      );

      return records.map((r: any) => ({
        qihao: r.qihao,
        opennum: r.opennum,
        sum: r.sum_value,
        opentime: r.opentime,
        is_da: r.is_da,
        is_xiao: r.is_xiao,
        is_dan: r.is_dan,
        is_shuang: r.is_shuang,
        combination: r.combination
      }));
    } catch (error) {
      logger.error(`[预测] 获取历史数据失败 错误:${error}`);
      return [];
    }
  }

  /**
   * 更新历史预测结果（当有新开奖时）
   */
  async updateHistoryPredictions(qihao: string, opennum: string, sumValue: number): Promise<void> {
    try {
      await this.writer.updateHistoryResults(qihao, opennum, sumValue);
      logger.debug(`[预测] 历史记录已更新 期号:${qihao}`);
    } catch (error) {
      logger.error(`[预测] 更新历史记录失败 期号:${qihao} 错误:${error}`);
    }
  }

  /**
   * 获取写入器实例（用于事件监听）
   */
  getWriter(): PredictionWriter {
    return this.writer;
  }
}

