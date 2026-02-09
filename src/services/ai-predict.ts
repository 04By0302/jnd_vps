import axios from 'axios';
import { logger } from '../libs/logger';
import { PredictType } from '../types';
import { retryAsync } from '../helpers/retry';

/**
 * DeepSeek AI预测服务
 */

/**
 * 判断 API 调用错误是否应该重试
 */
function shouldRetryAPICall(error: any): boolean {
  // HTTP 503 服务不可用
  if (error.response?.status === 503) return true;
  
  // HTTP 429 速率限制
  if (error.response?.status === 429) return true;
  
  // HTTP 502 网关错误
  if (error.response?.status === 502) return true;
  
  // HTTP 504 网关超时
  if (error.response?.status === 504) return true;
  
  // Axios 连接中止
  if (error.code === 'ECONNABORTED') return true;
  
  // 超时错误
  if (error.code === 'ETIMEDOUT') return true;
  
  // 连接重置
  if (error.code === 'ECONNRESET') return true;
  
  // 错误消息包含 aborted
  if (error.message?.includes('aborted')) return true;
  
  // 其他网络错误
  if (error.code === 'ENOTFOUND') return true;
  if (error.code === 'ENETUNREACH') return true;
  
  return false;
}

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DeepSeekRequest {
  model: string;
  messages: DeepSeekMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

interface DeepSeekResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/**
 * 调用DeepSeek API获取预测
 */
export async function callDeepSeekAPI(
  predictType: PredictType,
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
  }>,
  recentPredictions?: string[]
): Promise<string> {
  const apiKey = process.env.AI_API_KEY;
  const apiUrl = process.env.AI_API_URL || 'https://api.deepseek.com/v1/chat/completions';
  const model = process.env.AI_MODEL || 'deepseek-chat';
  const timeout = parseInt(process.env.AI_TIMEOUT || '20000');

  if (!apiKey) {
    throw new Error('AI_API_KEY未配置');
  }

  // 检测最近预测的偏向度，动态调整引导策略
  const biasInfo = detectBias(predictType, recentPredictions || []);
  
  const prompt = buildPrompt(predictType, historyData, biasInfo);
  const systemPrompt = getSystemPrompt(predictType, biasInfo);

  // 验证prompt长度（避免超出API限制）
  const totalPromptLength = systemPrompt.length + prompt.length;
  if (totalPromptLength > 4000) {
    logger.warn(`[AI] Prompt过长 类型:${predictType} 长度:${totalPromptLength}`);
  }

  // 动态temperature：优化速度，降低基础值
  const randomFactor = (Date.now() % 30) / 100; // 0-0.29（进一步减小）
  const baseTempBoost = biasInfo.hasBias ? 0.1 : 0; // 偏向时额外增加0.1
  const temperature = Math.min(0.8 + randomFactor + baseTempBoost, 1.2); // 0.8-1.19，更低更确定
  
  logger.debug(`[AI] 开始预测 类型:${predictType} prompt长度:${totalPromptLength} temp:${temperature.toFixed(2)}`);

  // 适当增加token避免输出被截断
  const maxTokens = 15;

  const request: DeepSeekRequest = {
    model,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: temperature,
    max_tokens: maxTokens,
    // 注意：OpenAI文档建议不要同时使用temperature和top_p
    // 这里优先使用temperature控制随机性
    frequency_penalty: 0.5,  // 降低到0.5（某些API可能不支持>1.0）
    presence_penalty: 0.3    // 降低到0.3（更保守的值）
  };

  try {
    // 使用重试机制调用 API
    const response = await retryAsync(
      async () => {
        return await axios.post<DeepSeekResponse>(apiUrl, request, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout
        });
      },
      {
        maxAttempts: 3,
        initialDelay: 2000,
        maxDelay: 10000,
        operation: `DeepSeek API调用(${predictType})`,
        shouldRetry: shouldRetryAPICall
      }
    );

    const content = response.data.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('AI返回内容为空');
    }

    logger.debug(`[AI] 预测成功 类型:${predictType} 返回:${content}`);
    return content;
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 'unknown';
      const errorData = error.response?.data || {};
      const errorDetail = JSON.stringify(errorData);
      logger.error(`[AI] 调用失败 类型:${predictType} 状态码:${status} 错误:${error.message}`);
      logger.debug(`[AI] 错误详情: ${errorDetail}`);
      logger.debug(`[AI] System Prompt: ${systemPrompt.substring(0, 100)}...`);
      logger.debug(`[AI] User Prompt: ${prompt.substring(0, 200)}...`);
      logger.debug(`[AI] 参数: temp=${temperature.toFixed(2)} max_tokens=${maxTokens}`);
    } else {
      logger.error(`[AI] 异常 类型:${predictType} 错误:${error}`);
    }
    throw error;
  }
}

/**
 * 偏向检测信息
 */
interface BiasInfo {
  hasBias: boolean;           // 是否存在偏向
  biasedValue?: string;       // 偏向的值
  biasRate?: number;          // 偏向比例
  shouldBalance: boolean;     // 是否需要平衡
  balanceHint?: string;       // 平衡提示
}

/**
 * 检测最近预测的偏向度
 * 
 * @param predictType 预测类型
 * @param recentPredictions 最近N次预测结果
 * @returns 偏向信息
 */
function detectBias(predictType: PredictType, recentPredictions: string[]): BiasInfo {
  if (recentPredictions.length < 5) {
    return { hasBias: false, shouldBalance: false };
  }

  // 统计最近预测
  const counts: Record<string, number> = {};
  recentPredictions.forEach(pred => {
    counts[pred] = (counts[pred] || 0) + 1;
  });

  const total = recentPredictions.length;
  let maxValue = '';
  let maxCount = 0;

  Object.entries(counts).forEach(([value, count]) => {
    if (count > maxCount) {
      maxCount = count;
      maxValue = value;
    }
  });

  const biasRate = maxCount / total;

  // 判定偏向：如果某个值占比超过70%，认为存在偏向
  const hasBias = biasRate > 0.7;
  const shouldBalance = hasBias;

  // 生成平衡提示
  let balanceHint = '';
  if (shouldBalance) {
    if (predictType === PredictType.DANSHUANG) {
      balanceHint = maxValue === '单' 
        ? '提示：最近预测较多偏向单，应考虑双的可能性以保持平衡。'
        : '提示：最近预测较多偏向双，应考虑单的可能性以保持平衡。';
    } else if (predictType === PredictType.DAXIAO) {
      balanceHint = maxValue === '小'
        ? '提示：最近预测较多偏向小，应考虑大的可能性以保持平衡。'
        : '提示：最近预测较多偏向大，应考虑小的可能性以保持平衡。';
    }
  }

  return {
    hasBias,
    biasedValue: hasBias ? maxValue : undefined,
    biasRate: hasBias ? biasRate : undefined,
    shouldBalance,
    balanceHint
  };
}

/**
 * AI预测系统提示词配置
 * 
 * 设计理念：
 * 1. 单双预测：侧重概率平衡和趋势反转，避免连续同向
 * 2. 大小预测：侧重和值区间和中位数回归理论
 * 3. 组合预测：综合大小+单双双重维度，寻找平衡点
 * 4. 杀号预测：反向思维，排除最不协调的组合
 * 5. 动态平衡：检测历史预测偏向，自然引导多样性
 * 
 * @param predictType 预测类型
 * @param biasInfo 偏向检测信息
 * @returns 对应类型的系统提示词
 */
function getSystemPrompt(predictType: PredictType, biasInfo: BiasInfo): string {
  const systemPrompts: Record<PredictType, string> = {
    [PredictType.DANSHUANG]: `规则：单=奇数和值，双=偶数和值。${biasInfo.shouldBalance ? '保持多样性。' : ''}只输出一个字：单 或 双（不要解释）`,

    [PredictType.DAXIAO]: `规则：小=0-13，大=14-27。${biasInfo.shouldBalance ? '保持多样性。' : ''}只输出一个字：小 或 大（不要解释）`,

    [PredictType.COMBINATION]: `规则：小单/小双/大单/大双。选2个不同组合。只输出：组合1,组合2（如：小单,大双，不要解释）`,

    [PredictType.KILL]: `规则：排除1个最不可能的组合。只输出一个组合：小单/小双/大单/大双（不要解释）`
  };

  return systemPrompts[predictType];
}

/**
 * 构建AI Prompt（优化版，支持动态平衡）
 */
function buildPrompt(
  predictType: PredictType,
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
  }>,
  biasInfo: BiasInfo
): string {
  // 增加分析范围：取最近20期数据，提供更多统计依据
  const recentData = historyData.slice(0, 20);
  
  // 计算统计信息
  const stats = calculateStats(recentData);
  
  // 只显示最近5期，提升速度
  const historyStr = recentData
    .slice(0, 5)
    .map((d) => {
      const nums = d.opennum.split('+');
      return `${nums[0]}+${nums[1]}+${nums[2]}=${d.sum}`;
    })
    .join(' ');
  
  // 简化趋势分析（最近3期）
  const recent3 = recentData.slice(0, 3);
  const trendAnalysis = analyzeTrend(predictType, recent3);

  // 构建当天统计信息（预先计算）
  let todayDanshuangInfo = '';
  let todayDaxiaoInfo = '';
  
  if (stats.todayCount > 0 && stats.today) {
    const danCount = stats.today.dan || 0;
    const shuangCount = stats.today.shuang || 0;
    const xiaoCount = stats.today.xiao || 0;
    const daCount = stats.today.da || 0;
    const danRate = stats.today.danRate || 0;
    const shuangRate = stats.today.shuangRate || 0;
    const xiaoRate = stats.today.xiaoRate || 0;
    const daRate = stats.today.daRate || 0;
    
    todayDanshuangInfo = ` 当天${stats.todayCount}期：单${danCount}次(${danRate}%) 双${shuangCount}次(${shuangRate}%)`;
    todayDaxiaoInfo = ` 当天${stats.todayCount}期：小${xiaoCount}次(${xiaoRate}%) 大${daCount}次(${daRate}%)`;
  }
  
  // 平衡提示（如果检测到偏向）
  const balanceHint = biasInfo.shouldBalance && biasInfo.balanceHint
    ? ` ${biasInfo.balanceHint}`
    : '';
  
  const specificPrompts: Record<PredictType, string> = {
    [PredictType.DANSHUANG]: `${historyStr}${todayDanshuangInfo} ${trendAnalysis}${balanceHint}`,

    [PredictType.DAXIAO]: `${historyStr}${todayDaxiaoInfo} ${trendAnalysis}${balanceHint}`,

    [PredictType.COMBINATION]: `${historyStr} ${trendAnalysis}`,

    [PredictType.KILL]: `${historyStr} ${trendAnalysis}`
  };

  return specificPrompts[predictType];
}

/**
 * 分析最近5期的趋势
 * 帮助AI识别连续性和反转信号
 */
function analyzeTrend(
  predictType: PredictType,
  recent3: Array<{ sum: number }>
): string {
  if (recent3.length === 0) return '';

  if (predictType === PredictType.DANSHUANG) {
    return recent3.map(d => d.sum % 2 === 1 ? '单' : '双').join('→');
  }

  if (predictType === PredictType.DAXIAO) {
    return recent3.map(d => d.sum >= 14 ? '大' : '小').join('→');
  }

  if (predictType === PredictType.COMBINATION || predictType === PredictType.KILL) {
    return recent3.map(d => {
      const isDa = d.sum >= 14;
      const isDan = d.sum % 2 === 1;
      if (!isDa && isDan) return '小单';
      if (!isDa && !isDan) return '小双';
      if (isDa && isDan) return '大单';
      return '大双';
    }).join('→');
  }

  return '';
}

/**
 * 计算统计信息用于AI分析（优化版）
 * 
 * 优化说明：
 * - 统计最近20期数据（增加分析范围，提供更多依据）
 * - 简化统计维度，保留核心指标
 * - 优先使用预计算属性（如有）
 */
function calculateStats(
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
): any {
  const recent20 = historyData.slice(0, 20);

  // 提取当天数据（根据opentime日期）
  const latestOpentime = recent20[0]?.opentime;
  const todayData = latestOpentime 
    ? historyData.filter(d => {
        if (!d.opentime) return false;
        const dDate = new Date(d.opentime);
        const latestDate = new Date(latestOpentime);
        return dDate.getFullYear() === latestDate.getFullYear() &&
               dDate.getMonth() === latestDate.getMonth() &&
               dDate.getDate() === latestDate.getDate();
      })
    : [];

  // 统计结构
  const stats: any = {
    recent10: {},
    today: {},
    sumRange: '',
    todayCount: todayData.length
  };

  // 检查是否有预计算字段
  const hasPrecomputed = recent20[0]?.is_dan !== undefined;

  // 计算20期统计
  if (hasPrecomputed) {
    stats.recent10.dan = recent20.filter(d => d.is_dan).length;
    stats.recent10.shuang = recent20.filter(d => d.is_shuang).length;
    stats.recent10.da = recent20.filter(d => d.is_da).length;
    stats.recent10.xiao = recent20.filter(d => d.is_xiao).length;
    stats.recent10.dd = recent20.filter(d => d.combination === '大单').length;
    stats.recent10.xd = recent20.filter(d => d.combination === '小单').length;
    stats.recent10.ds = recent20.filter(d => d.combination === '大双').length;
    stats.recent10.xs = recent20.filter(d => d.combination === '小双').length;
  } else {
    stats.recent10.dan = recent20.filter(d => d.sum % 2 === 1).length;
    stats.recent10.shuang = recent20.filter(d => d.sum % 2 === 0).length;
    stats.recent10.da = recent20.filter(d => d.sum >= 14).length;
    stats.recent10.xiao = recent20.filter(d => d.sum <= 13).length;
    stats.recent10.dd = recent20.filter(d => d.sum >= 14 && d.sum % 2 === 1).length;
    stats.recent10.xd = recent20.filter(d => d.sum <= 13 && d.sum % 2 === 1).length;
    stats.recent10.ds = recent20.filter(d => d.sum >= 14 && d.sum % 2 === 0).length;
    stats.recent10.xs = recent20.filter(d => d.sum <= 13 && d.sum % 2 === 0).length;
  }

  // 计算当天统计（高效）
  if (todayData.length > 0) {
    if (hasPrecomputed) {
      stats.today.dan = todayData.filter(d => d.is_dan).length;
      stats.today.shuang = todayData.filter(d => d.is_shuang).length;
      stats.today.da = todayData.filter(d => d.is_da).length;
      stats.today.xiao = todayData.filter(d => d.is_xiao).length;
    } else {
      stats.today.dan = todayData.filter(d => d.sum % 2 === 1).length;
      stats.today.shuang = todayData.filter(d => d.sum % 2 === 0).length;
      stats.today.da = todayData.filter(d => d.sum >= 14).length;
      stats.today.xiao = todayData.filter(d => d.sum <= 13).length;
    }
    
    // 计算当天比例
    stats.today.danRate = ((stats.today.dan / todayData.length) * 100).toFixed(0);
    stats.today.shuangRate = ((stats.today.shuang / todayData.length) * 100).toFixed(0);
    stats.today.daRate = ((stats.today.da / todayData.length) * 100).toFixed(0);
    stats.today.xiaoRate = ((stats.today.xiao / todayData.length) * 100).toFixed(0);
  }

  // 和值范围
  const sums = recent20.map(d => d.sum);
  stats.sumRange = sums.length > 0 ? `${Math.min(...sums)}-${Math.max(...sums)}` : '0-0';

  return stats;
}

/**
 * 解析AI返回的预测值（直接中文解析）
 */
export function parsePredictValue(predictType: PredictType, aiResponse: string): string {
  const response = aiResponse.trim();

  if (predictType === PredictType.DANSHUANG) {
    // 直接解析中文
    if (response.includes('单')) return '单';
    if (response.includes('双')) return '双';
    throw new Error(`AI返回值无效: ${aiResponse}, 预期: 单 或 双`);
  }

  if (predictType === PredictType.DAXIAO) {
    // 直接解析中文
    if (response.includes('大')) return '大';
    if (response.includes('小')) return '小';
    throw new Error(`AI返回值无效: ${aiResponse}, 预期: 小 或 大`);
  }

  if (predictType === PredictType.COMBINATION) {
    // 解析中文组合格式
    const combos = ['大单', '小单', '大双', '小双'];
    const found = combos.filter(c => response.includes(c));
    if (found.length >= 2) {
      // 取前两个匹配的组合
      return `${found[0]},${found[1]}`;
    }
    throw new Error(`AI返回值无效: ${aiResponse}, 预期: 两个组合（如：小单,大双）`);
  }

  if (predictType === PredictType.KILL) {
    // 直接解析中文
    const combos = ['大单', '小单', '大双', '小双'];
    for (const combo of combos) {
      if (response.includes(combo)) {
        return combo;
      }
    }
    throw new Error(`AI返回值无效: ${aiResponse}, 预期: 小单、小双、大单 或 大双`);
  }

  throw new Error(`未知预测类型: ${predictType}`);
}

