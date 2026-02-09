import { BaseLotteryData } from '../types';
import { logger } from '../libs/logger';

/**
 * 字段映射配置
 * 定义不同数据源可能使用的字段名
 */
const FIELD_MAPPINGS = {
  // 期号的可能字段名
  issue: ['qihao', 'expect', 'issue', 'period', 'lottery_no', 'issue_no'],
  // 开奖时间的可能字段名
  time: ['opentime', 'open_time', 'openTime', 'time', 'draw_time', 'drawTime', 'lottery_time'],
  // 开奖号码的可能字段名
  numbers: ['opennum', 'open_code', 'openCode', 'numbers', 'result', 'draw_code', 'drawCode'],
  // 和值的可能字段名
  sum: ['sum', 'sum_value', 'sumValue', 'total']
};

/**
 * 智能解析：自动识别JSON格式并提取数据
 * 
 * 该函数能够：
 * - 自动解析JSON字符串
 * - 从各种嵌套结构中提取数据记录
 * - 智能匹配不同命名的字段
 * - 标准化号码格式
 * - 自动计算和值
 * 
 * @param responseData 原始响应数据（可以是对象或JSON字符串）
 * @param sourceName 数据源名称（用于日志）
 * @returns 解析后的标准格式数据，解析失败返回null
 * 
 * @example
 * ```typescript
 * const data = parseUniversalFormat(response, 'openjiang');
 * if (data) {
 *   console.log(data.qihao, data.opennum);
 * }
 * ```
 */
export function parseUniversalFormat(responseData: any, sourceName: string): BaseLotteryData | null {
  try {
    const parsedData = parseToObject(responseData, sourceName);
    if (!parsedData) return null;

    const record = extractRecord(parsedData);
    if (!record) {
      logger.debug({ sourceName }, '无法提取数据记录');
      return null;
    }

    const extractedFields = extractRequiredFields(record, sourceName);
    if (!extractedFields) return null;

    const normalizedNumbers = normalizeNumbers(extractedFields.numbers);
    if (!normalizedNumbers) {
      logger.warn({ numbers: extractedFields.numbers, sourceName }, '号码格式无法解析');
      return null;
    }

    const sum = extractedFields.sum || calculateSum(normalizedNumbers);

    return buildLotteryData({
      issue: extractedFields.issue,
      time: extractedFields.time,
      numbers: normalizedNumbers,
      sum,
      sourceName
    });

  } catch (error) {
    logger.error({ error, sourceName }, '通用解析失败');
    return null;
  }
}

/**
 * 将响应数据解析为对象
 * @param responseData 原始响应数据
 * @param sourceName 数据源名称
 * @returns 解析后的对象，失败返回null
 */
function parseToObject(responseData: any, sourceName: string): any {
  if (!responseData) {
    logger.debug({ sourceName }, '数据源返回空值');
    return null;
  }

  if (typeof responseData === 'string') {
    return parseJSONString(responseData, sourceName);
  }

  return responseData;
}

/**
 * 解析JSON字符串
 * @param jsonString JSON字符串
 * @param sourceName 数据源名称
 * @returns 解析后的对象，失败返回null
 */
function parseJSONString(jsonString: string, sourceName: string): any {
  try {
    return JSON.parse(jsonString);
  } catch {
    if (sourceName !== 'openjiang') {
      logger.warn({ sourceName }, '无法解析字符串为JSON');
    }
    return null;
  }
}

/**
 * 提取必需字段
 * @param record 数据记录
 * @param sourceName 数据源名称
 * @returns 提取的字段对象，缺失关键字段返回null
 */
function extractRequiredFields(record: any, sourceName: string): { 
  issue: any; 
  time: any; 
  numbers: any; 
  sum: any 
} | null {
  const issue = findField(record, FIELD_MAPPINGS.issue);
  const time = findField(record, FIELD_MAPPINGS.time);
  const numbers = findField(record, FIELD_MAPPINGS.numbers);
  const sum = findField(record, FIELD_MAPPINGS.sum);

  if (!issue || !time || !numbers) {
    logger.warn({ 
      record, 
      sourceName,
      found: { issue: !!issue, time: !!time, numbers: !!numbers }
    }, '关键字段缺失');
    return null;
  }

  return { issue, time, numbers, sum };
}

/**
 * 计算号码的和值
 * @param numbers 标准化后的号码字符串（格式：a+b+c）
 * @returns 和值
 */
function calculateSum(numbers: string): number {
  const parts = numbers.split('+').map(n => parseInt(n));
  return parts.reduce((a, b) => a + b, 0);
}

/**
 * 构建标准格式的彩票数据对象
 * @param params 参数对象
 * @returns 标准格式的彩票数据
 */
function buildLotteryData(params: {
  issue: any;
  time: any;
  numbers: string;
  sum: number;
  sourceName: string;
}): BaseLotteryData {
  return {
    qihao: String(params.issue).trim(),
    opentime: normalizeTime(String(params.time)),
    opennum: params.numbers,
    sum_value: parseInt(String(params.sum)),
    source: params.sourceName
  };
}

/**
 * 从响应数据中提取实际的数据记录
 * 处理各种嵌套结构：直接对象、data数组、result数组等
 */
function extractRecord(data: any): any {
  // 如果本身就是有效记录
  if (isValidRecord(data)) {
    return data;
  }

  // 常见的数据容器字段
  const containerFields = ['data', 'result', 'results', 'list', 'items', 'rows', 'records'];

  // 尝试从容器字段中提取
  for (const field of containerFields) {
    if (data[field]) {
      const container = data[field];
      
      // 如果是数组，取第一个
      if (Array.isArray(container) && container.length > 0) {
        return container[0];
      }
      
      // 如果是对象，直接返回
      if (typeof container === 'object') {
        return container;
      }
    }
  }

  // 如果data本身是数组，取第一个
  if (Array.isArray(data) && data.length > 0) {
    return data[0];
  }

  return data;
}

/**
 * 检查对象是否是有效的数据记录
 */
function isValidRecord(obj: any): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }

  // 至少包含一个关键字段
  const allFields = [
    ...FIELD_MAPPINGS.issue,
    ...FIELD_MAPPINGS.time,
    ...FIELD_MAPPINGS.numbers
  ];

  return allFields.some(field => obj.hasOwnProperty(field));
}

/**
 * 在对象中查找字段（支持多个可能的字段名）
 */
function findField(obj: any, possibleFields: string[]): any {
  for (const field of possibleFields) {
    // 精确匹配
    if (obj.hasOwnProperty(field) && obj[field] !== null && obj[field] !== undefined) {
      return obj[field];
    }

    // 不区分大小写匹配
    const lowerField = field.toLowerCase();
    for (const key in obj) {
      if (key.toLowerCase() === lowerField && obj[key] !== null && obj[key] !== undefined) {
        return obj[key];
      }
    }
  }

  return null;
}

/**
 * 标准化号码格式
 * 支持：1+2+3、1,2,3、1 2 3、123等格式
 * 统一转换为：a+b+c
 */
function normalizeNumbers(numbers: any): string | null {
  const str = String(numbers).trim();

  // 已经是标准格式：a+b+c
  if (/^\d+\+\d+\+\d+$/.test(str)) {
    return str;
  }

  // 逗号分隔：a,b,c
  if (/^\d+,\d+,\d+$/.test(str)) {
    return str.replace(/,/g, '+');
  }

  // 空格分隔：a b c
  if (/^\d+\s+\d+\s+\d+$/.test(str)) {
    return str.replace(/\s+/g, '+');
  }

  // 连续三位数字：abc
  if (/^\d{3}$/.test(str)) {
    return `${str[0]}+${str[1]}+${str[2]}`;
  }

  // 其他分隔符尝试
  const parts = str.split(/[^\d]+/).filter(p => p.length > 0);
  if (parts.length === 3 && parts.every(p => /^\d+$/.test(p))) {
    return parts.join('+');
  }

  return null;
}

/**
 * 兼容旧接口：标准格式解析
 */
export function parseStandardFormat(responseData: any, sourceName: string): BaseLotteryData | null {
  return parseUniversalFormat(responseData, sourceName);
}

/**
 * 兼容旧接口：openjiang格式解析
 */
export function parseOpenjiangFormat(responseData: any): BaseLotteryData | null {
  return parseUniversalFormat(responseData, 'openjiang');
}

/**
 * 标准化时间格式
 * 将 "12-09 00:20:30" 转换为 "2025-12-09 00:20:30"
 */
function normalizeTime(timeStr: string): string {
  // 如果已经是完整格式，直接返回
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(timeStr)) {
    return timeStr;
  }

  // 如果是短格式 "12-09 00:20:30"，添加年份
  if (/^\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(timeStr)) {
    const currentYear = new Date().getFullYear();
    return `${currentYear}-${timeStr}`;
  }

  return timeStr;
}

/**
 * 统一数据格式
 */
export function normalizeData(data: BaseLotteryData): BaseLotteryData {
  return {
    ...data,
    qihao: String(data.qihao).trim(),
    opentime: normalizeTime(data.opentime),
    opennum: String(data.opennum).trim(),
    sum_value: parseInt(String(data.sum_value)),
    source: data.source.toLowerCase()
  };
}

