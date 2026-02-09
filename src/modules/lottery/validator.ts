import { LotteryData, ValidationResult } from '../../types';
import { 
  validateSum, 
  validateIssue, 
  validateTime, 
  validateOpennum,
  parseOpennum,
  isIssueIncreasing
} from '../../helpers/validator';
import { getLastIssue } from '../cache/deduplication';
import { logger } from '../../libs/logger';

/**
 * 彩票数据完整校验
 * 
 * 对彩票数据执行多层次校验，确保数据的完整性和准确性：
 * 1. 期号格式校验（必须为7位数字）
 * 2. 开奖号码格式校验（必须为"数字+数字+数字"格式，每个数字0-9）
 * 3. 时间格式校验（支持短格式和完整格式）
 * 4. 和值一致性校验（确保号码之和等于记录的和值）
 * 5. 期号递增性检查（可选，用于识别旧数据，但不阻止处理）
 * 
 * @param data 待校验的彩票数据
 * @returns 校验结果，包含是否有效和错误信息
 * 
 * @example
 * ```typescript
 * const result = await validateLotteryData(data);
 * if (!result.valid) {
 *   console.error('数据校验失败:', result.error);
 * }
 * ```
 */
export async function validateLotteryData(data: LotteryData): Promise<ValidationResult> {
  const issueValidation = validateDataIssue(data.qihao);
  if (!issueValidation.valid) return issueValidation;

  const opennumValidation = validateDataOpennum(data.opennum);
  if (!opennumValidation.valid) return opennumValidation;

  const timeValidation = validateDataTime(data.opentime);
  if (!timeValidation.valid) return timeValidation;

  const sumValidation = validateDataSum(data.opennum, data.sum_value);
  if (!sumValidation.valid) return sumValidation;

  await checkIssueIncrement(data.qihao);

  return { valid: true };
}

/**
 * 校验数据期号
 * @param qihao 期号
 * @returns 校验结果
 */
function validateDataIssue(qihao: string): ValidationResult {
  return validateIssue(qihao);
}

/**
 * 校验数据开奖号码
 * @param opennum 开奖号码
 * @returns 校验结果
 */
function validateDataOpennum(opennum: string): ValidationResult {
  return validateOpennum(opennum);
}

/**
 * 校验数据时间
 * @param opentime 开奖时间
 * @returns 校验结果
 */
function validateDataTime(opentime: string): ValidationResult {
  return validateTime(opentime);
}

/**
 * 校验数据和值
 * @param opennum 开奖号码
 * @param sumValue 和值
 * @returns 校验结果
 */
function validateDataSum(opennum: string, sumValue: number): ValidationResult {
  const parsed = parseOpennum(opennum);
  
  if (!parsed) {
    return {
      valid: false,
      error: '无法解析开奖号码'
    };
  }

  return validateSum(parsed.a, parsed.b, parsed.c, sumValue);
}

/**
 * 检查期号递增性
 * 
 * 将当前期号与最后处理的期号比较
 * 如果期号未递增，记录警告但不阻止处理（允许多源并发抓取历史数据）
 * 
 * @param currentIssue 当前期号
 */
async function checkIssueIncrement(currentIssue: string): Promise<void> {
  const lastIssue = await getLastIssue();
  
  if (lastIssue && !isIssueIncreasing(currentIssue, lastIssue)) {
    logger.warn({ 
      currentIssue, 
      lastIssue 
    }, '期号未递增，可能是旧数据');
  }
}






