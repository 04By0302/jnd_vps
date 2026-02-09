import { EventEmitter } from 'events';
import { writeDB } from '../../database/client';
import { logger } from '../../libs/logger';
import { PredictType } from '../../types';
import { withRetry } from '../../database/operations';
import { getCurrentTimeString } from '../../helpers/datetime';

/**
 * 预测数据写入器
 * 负责将AI预测结果写入数据库
 */
export class PredictionWriter extends EventEmitter {
  /**
   * 保存预测数据（新预测）
   */
  async savePrediction(data: {
    qihao: string;
    predictType: PredictType;
    predictValue: string;
  }, silent: boolean = false): Promise<void> {
    try {
      await withRetry(
        async () => {
          await writeDB.ai_predictions.upsert({
            where: {
              qihao_predict_type: {
                qihao: data.qihao,
                predict_type: data.predictType
              }
            },
            create: {
              qihao: data.qihao,
              predict_type: data.predictType,
              predict_value: data.predictValue,
              opennum: null,
              sum_value: null,
              result_value: null,
              hit: null
            },
            update: {
              predict_value: data.predictValue,
              updated_at: new Date()
            }
          });
        },
        { operation: `保存预测数据(${data.qihao}-${data.predictType})` }
      );

      // 静默模式不输出日志
      if (!silent) {
        logger.info(`预测已保存 期号:${data.qihao} 类型:${data.predictType} 预测:${data.predictValue}`);
      }

      this.emit('predictionSaved', data);
    } catch (error) {
      logger.error(`保存预测失败 期号:${data.qihao} 类型:${data.predictType} 错误:${error}`);
      throw error;
    }
  }

  /**
   * 更新预测结果（开奖后填充）
   */
  async updatePredictionResult(data: {
    qihao: string;
    predictType: PredictType;
    opennum: string;
    sumValue: number;
    resultValue: string;
    hit: boolean;
  }): Promise<void> {
    try {
      await withRetry(
        async () => {
          await writeDB.ai_predictions.updateMany({
            where: {
              qihao: data.qihao,
              predict_type: data.predictType
            },
            data: {
              opennum: data.opennum,
              sum_value: data.sumValue,
              result_value: data.resultValue,
              hit: data.hit,
              updated_at: new Date()
            }
          });
        },
        { operation: `更新预测结果(${data.qihao}-${data.predictType})` }
      );

      this.emit('resultUpdated', data);
    } catch (error) {
      logger.error(`更新预测失败 期号:${data.qihao} 类型:${data.predictType} 错误:${error}`);
      throw error;
    }
  }

  /**
   * 批量更新历史预测的开奖结果
   */
  async updateHistoryResults(qihao: string, opennum: string, sumValue: number): Promise<void> {
    const allTypes = [
      PredictType.DANSHUANG,
      PredictType.DAXIAO,
      PredictType.COMBINATION,
      PredictType.KILL
    ];

    const results: Record<string, { value: string; hit: boolean }> = {};
    let hitCount = 0;
    let totalCount = 0;

    for (const predictType of allTypes) {
      const resultValue = calculateResultValue(predictType, sumValue);
      const prediction = await this.getPrediction(qihao, predictType);

      if (prediction) {
        const hit = calculateHit(predictType, prediction.predict_value, resultValue);
        await this.updatePredictionResult({
          qihao,
          predictType,
          opennum,
          sumValue,
          resultValue,
          hit
        });
        
        results[predictType] = { value: prediction.predict_value, hit };
        if (hit) hitCount++;
        totalCount++;
      }
    }

    // 输出统一格式的日志
    if (totalCount > 0) {
      this.logPredictionCheck(qihao, opennum, sumValue, results, hitCount, totalCount);
    }
  }

  /**
   * 记录预测验证日志（统一格式）
   */
  private logPredictionCheck(
    qihao: string,
    opennum: string,
    sumValue: number,
    results: Record<string, { value: string; hit: boolean }>,
    hitCount: number,
    totalCount: number
  ): void {
    const currentTime = getCurrentTimeString();
    const sumDisplay = String(sumValue).padStart(2, '0');
    
    const typeMap: Record<string, string> = {
      'danshuang': '单双',
      'daxiao': '大小',
      'combination': '组合',
      'kill': '杀号'
    };
    
    const resultParts: string[] = [];
    for (const [type, data] of Object.entries(results)) {
      const typeName = typeMap[type] || type;
      const symbol = data.hit ? '✓' : '✗';
      // 杀号类型需要加"杀"前缀
      const displayValue = type === 'kill' ? `杀${data.value}` : data.value;
      resultParts.push(`${typeName}:${displayValue}${symbol}`);
    }
    
    const resultStr = resultParts.join(' | ');
    const accuracy = `${hitCount}/${totalCount}`;
    
    logger.info(`[预测验证] ${currentTime} | 期号: ${qihao} | 号码: ${opennum} | 和值: ${sumDisplay} | ${resultStr} | 准确率: ${accuracy}`);
  }

  /**
   * 获取预测记录
   */
  private async getPrediction(qihao: string, predictType: PredictType) {
    return await withRetry(
      async () => {
        return await writeDB.ai_predictions.findUnique({
          where: {
            qihao_predict_type: {
              qihao,
              predict_type: predictType
            }
          }
        });
      },
      { operation: `获取预测记录(${qihao}-${predictType})` }
    );
  }
}

/**
 * 计算实际结果值
 */
function calculateResultValue(predictType: PredictType, sumValue: number): string {
  switch (predictType) {
    case PredictType.DANSHUANG:
      return sumValue % 2 === 1 ? '单' : '双';

    case PredictType.DAXIAO:
      return sumValue >= 14 ? '大' : '小';

    case PredictType.COMBINATION:
    case PredictType.KILL: {
      const isDa = sumValue >= 14;
      const isDan = sumValue % 2 === 1;
      if (isDa && isDan) return '大单';
      if (!isDa && isDan) return '小单';
      if (isDa && !isDan) return '大双';
      return '小双';
    }

    default:
      throw new Error(`未知预测类型: ${predictType}`);
  }
}

/**
 * 计算是否命中
 */
function calculateHit(predictType: PredictType, predictValue: string, resultValue: string): boolean {
  switch (predictType) {
    case PredictType.DANSHUANG:
    case PredictType.DAXIAO:
      // 严格匹配
      return predictValue === resultValue;

    case PredictType.COMBINATION: {
      // 双组合匹配：预测值是"小单,大双"格式，判断结果是否在其中
      const predictCombos = predictValue.split(',').map(s => s.trim());
      // 如果实际结果匹配预测的任意一个组合，即算命中
      return predictCombos.includes(resultValue);
    }

    case PredictType.KILL:
      // 反向匹配：不是被杀的组合即算中
      return predictValue !== resultValue;

    default:
      return false;
  }
}

