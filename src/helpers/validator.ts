import { ValidationResult } from '../types';

/**
 * 数据校验工具模块
 * 
 * 提供彩票数据的各项校验功能，包括：
 * - 和值校验：确保号码之和与记录的和值一致
 * - 期号格式校验：验证期号是否符合7位数字格式
 * - 时间格式校验：验证时间字符串格式是否正确
 * - 期号递增校验：验证新期号是否大于旧期号
 * - 开奖号码格式校验：验证号码格式和数值范围
 */

/**
 * 校验和值是否正确
 * 
 * 验证三个号码的和是否等于给定的和值
 * 这是数据完整性检查的关键步骤
 * 
 * @param a 第一个号码
 * @param b 第二个号码
 * @param c 第三个号码
 * @param sum 期望的和值
 * @returns 校验结果，包含是否有效和错误信息
 * 
 * @example
 * ```typescript
 * const result = validateSum(3, 5, 8, 16);
 * if (!result.valid) {
 *   console.error(result.error);
 * }
 * ```
 */
export function validateSum(a: number, b: number, c: number, sum: number): ValidationResult {
  const calculatedSum = a + b + c;
  
  if (calculatedSum !== sum) {
    return {
      valid: false,
      error: `和值校验失败: ${a}+${b}+${c}=${calculatedSum}, 实际值=${sum}`
    };
  }
  
  return { valid: true };
}

/**
 * 校验期号格式
 * 
 * 期号必须是7位数字，格式如：2025001
 * 通常前4位表示年份，后3位表示期数
 * 
 * @param issue 期号字符串
 * @returns 校验结果，包含是否有效和错误信息
 * 
 * @example
 * ```typescript
 * validateIssue('2025001'); // { valid: true }
 * validateIssue('123');     // { valid: false, error: '...' }
 * ```
 */
export function validateIssue(issue: string): ValidationResult {
  const ISSUE_PATTERN = /^\d{7}$/;
  
  if (!ISSUE_PATTERN.test(issue)) {
    return {
      valid: false,
      error: `期号格式错误: ${issue}，应为7位数字`
    };
  }
  
  return { valid: true };
}

/**
 * 校验时间格式
 * 
 * 支持两种时间格式：
 * 1. 短格式：MM-DD HH:mm:ss（如：12-09 00:20:30）
 * 2. 完整格式：YYYY-MM-DD HH:mm:ss（如：2025-12-09 00:20:30）
 * 
 * @param timeStr 时间字符串
 * @returns 校验结果，包含是否有效和错误信息
 * 
 * @example
 * ```typescript
 * validateTime('2025-12-09 00:20:30'); // { valid: true }
 * validateTime('12-09 00:20:30');      // { valid: true }
 * validateTime('invalid');             // { valid: false, error: '...' }
 * ```
 */
export function validateTime(timeStr: string): ValidationResult {
  const SHORT_FORMAT = /^\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/;
  const FULL_FORMAT = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/;
  
  const isValidFormat = SHORT_FORMAT.test(timeStr) || FULL_FORMAT.test(timeStr);
  
  if (!isValidFormat) {
    return {
      valid: false,
      error: `时间格式错误: ${timeStr}`
    };
  }
  
  return { valid: true };
}

/**
 * 校验期号是否递增
 * 
 * 用于验证新数据的期号是否大于历史数据的期号
 * 这可以防止旧数据被错误地当作新数据处理
 * 
 * @param currentIssue 当前期号
 * @param previousIssue 之前的期号
 * @returns 如果当前期号大于之前期号返回true，否则返回false
 * 
 * @example
 * ```typescript
 * isIssueIncreasing('2025002', '2025001'); // true
 * isIssueIncreasing('2025001', '2025002'); // false
 * ```
 */
export function isIssueIncreasing(currentIssue: string, previousIssue: string): boolean {
  const current = parseInt(currentIssue);
  const previous = parseInt(previousIssue);
  return current > previous;
}

/**
 * 校验开奖号码格式
 * 
 * 验证开奖号码是否符合以下要求：
 * 1. 格式为 "数字+数字+数字"（用加号分隔）
 * 2. 每个数字必须在0-9之间
 * 3. 必须恰好有三个数字
 * 
 * @param opennum 开奖号码字符串
 * @returns 校验结果，包含是否有效和错误信息
 * 
 * @example
 * ```typescript
 * validateOpennum('3+5+8');  // { valid: true }
 * validateOpennum('3-5-8');  // { valid: false, error: '...' }
 * validateOpennum('10+5+8'); // { valid: false, error: '...' } (超出范围)
 * ```
 */
export function validateOpennum(opennum: string): ValidationResult {
  const OPENNUM_PATTERN = /^\d+\+\d+\+\d+$/;
  
  if (!OPENNUM_PATTERN.test(opennum)) {
    return {
      valid: false,
      error: `开奖号码格式错误: ${opennum}，应为 "数字+数字+数字"`
    };
  }
  
  const numbers = parseNumbersFromOpennum(opennum);
  const rangeValidation = validateNumbersRange(numbers, opennum);
  
  if (!rangeValidation.valid) {
    return rangeValidation;
  }
  
  return { valid: true };
}

/**
 * 从开奖号码字符串中解析数字数组
 * @param opennum 开奖号码字符串
 * @returns 数字数组
 */
function parseNumbersFromOpennum(opennum: string): number[] {
  return opennum.split('+').map(n => parseInt(n));
}

/**
 * 验证号码范围
 * @param numbers 数字数组
 * @param opennum 原始号码字符串（用于错误信息）
 * @returns 校验结果
 */
function validateNumbersRange(numbers: number[], opennum: string): ValidationResult {
  const MIN_NUMBER = 0;
  const MAX_NUMBER = 9;
  
  for (const num of numbers) {
    if (num < MIN_NUMBER || num > MAX_NUMBER) {
      return {
        valid: false,
        error: `开奖号码数字超出范围: ${opennum}，每个数字应在${MIN_NUMBER}-${MAX_NUMBER}之间`
      };
    }
  }
  
  return { valid: true };
}

/**
 * 从开奖号码中提取三个数字和和值
 * 
 * 将标准格式的开奖号码（a+b+c）解析为独立的数字和它们的和
 * 
 * @param opennum 开奖号码字符串（格式：a+b+c）
 * @returns 包含三个数字和和值的对象，格式错误返回null
 * 
 * @example
 * ```typescript
 * parseOpennum('3+5+8'); // { a: 3, b: 5, c: 8, sum: 16 }
 * parseOpennum('invalid'); // null
 * ```
 */
export function parseOpennum(opennum: string): { a: number; b: number; c: number; sum: number } | null {
  const parts = opennum.split('+').map(n => parseInt(n));
  
  if (parts.length !== 3) {
    return null;
  }
  
  const [a, b, c] = parts;
  const sum = a + b + c;
  
  return { a, b, c, sum };
}






