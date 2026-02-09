/**
 * 彩票数据分析工具
 * 统一封装所有统计判断逻辑，避免代码重复
 */

import { STAT_TYPE_KEYS } from '../config/stat-types';
import type { LotteryData } from '../types';

/**
 * 和值分析结果
 */
export interface SumAnalysis {
  isDa: boolean;      // 大（>= 14）
  isXiao: boolean;    // 小（<= 13）
  isDan: boolean;     // 单（奇数）
  isShuang: boolean;  // 双（偶数）
  isJiDa: boolean;    // 极大（>= 22）
  isJiXiao: boolean;  // 极小（<= 5）
  combination: string; // 组合类型：大单/小单/大双/小双
  isXiaoBian: boolean; // 小边（0-9）
  isZhong: boolean;    // 中（10-17）
  isDaBian: boolean;   // 大边（18-27）
  isBian: boolean;     // 边（小边或大边）
}

/**
 * 号码形态分析结果
 */
export interface PatternAnalysis {
  isBaozi: boolean;   // 豹子（三个数相同）
  isDuizi: boolean;   // 对子（两个数相同）
  isShunzi: boolean;  // 顺子（三个连续数）
  isZaliu: boolean;   // 杂六（其他情况）
}

/**
 * 龙虎合分析结果
 */
export interface LongHuHeAnalysis {
  isLong: boolean;    // 龙（num1 > num3）
  isHu: boolean;      // 虎（num1 < num3）
  isHe: boolean;      // 合（num1 = num3）
}

/**
 * 完整分析结果
 */
export interface LotteryAnalysis {
  sum: SumAnalysis;
  pattern: PatternAnalysis;
  longHuHe: LongHuHeAnalysis;
  types: string[];    // 所有命中的统计类型
}

/**
 * 分析和值属性
 * 
 * @param sum - 和值（0-27）
 * @returns 和值的各项统计属性
 */
export function analyzeSumValue(sum: number): SumAnalysis {
  const isDa = sum >= 14;
  const isXiao = sum <= 13;
  const isDan = sum % 2 === 1;
  const isShuang = sum % 2 === 0;
  const isJiDa = sum >= 22;
  const isJiXiao = sum <= 5;
  
  // 边属性
  const isXiaoBian = sum >= 0 && sum <= 9;
  const isZhong = sum >= 10 && sum <= 17;
  const isDaBian = sum >= 18 && sum <= 27;
  const isBian = isXiaoBian || isDaBian;
  
  let combination: string;
  if (isDa && isDan) combination = '大单';
  else if (isXiao && isDan) combination = '小单';
  else if (isDa && isShuang) combination = '大双';
  else combination = '小双';
  
  return { isDa, isXiao, isDan, isShuang, isJiDa, isJiXiao, combination, isXiaoBian, isZhong, isDaBian, isBian };
}

/**
 * 分析号码形态
 * 
 * @param numbers - 三个开奖号码数组
 * @returns 号码形态分析结果（豹子/对子/顺子/杂六）
 */
export function analyzePattern(numbers: number[]): PatternAnalysis {
  const [a, b, c] = numbers;
  const isBaozi = a === b && b === c;
  const isDuizi = !isBaozi && (a === b || b === c || a === c);
  const sorted = [...numbers].sort((x, y) => x - y);
  const isShunzi = !isBaozi && !isDuizi && 
    sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1;
  const isZaliu = !isBaozi && !isDuizi && !isShunzi;
  
  return { isBaozi, isDuizi, isShunzi, isZaliu };
}

/**
 * 分析龙虎合
 * 
 * @param numbers - 三个开奖号码数组
 * @returns 龙虎合分析结果
 */
export function analyzeLongHuHe(numbers: number[]): LongHuHeAnalysis {
  const [num1, , num3] = numbers;
  const isLong = num1 > num3;
  const isHu = num1 < num3;
  const isHe = num1 === num3;
  
  return { isLong, isHu, isHe };
}

/**
 * 收集所有命中的统计类型
 * 
 * @param sum - 和值
 * @param pattern - 形态分析结果
 * @param longHuHe - 龙虎合分析结果
 * @returns 所有命中类型的字符串数组
 */
export function collectStatTypes(sum: number, pattern: PatternAnalysis, longHuHe: LongHuHeAnalysis): string[] {
  const types: string[] = [];
  const sumAnalysis = analyzeSumValue(sum);
  
  // 大小
  if (sumAnalysis.isDa) types.push('da');
  if (sumAnalysis.isXiao) types.push('xiao');
  
  // 单双
  if (sumAnalysis.isDan) types.push('dan');
  if (sumAnalysis.isShuang) types.push('shuang');
  
  // 组合
  if (sumAnalysis.isDa && sumAnalysis.isDan) types.push('dd');
  if (sumAnalysis.isXiao && sumAnalysis.isDan) types.push('xd');
  if (sumAnalysis.isDa && sumAnalysis.isShuang) types.push('ds');
  if (sumAnalysis.isXiao && sumAnalysis.isShuang) types.push('xs');
  
  // 极值
  if (sumAnalysis.isJiDa) types.push('jd');
  if (sumAnalysis.isJiXiao) types.push('jx');
  
  // 形态
  if (pattern.isBaozi) types.push('bz');
  if (pattern.isDuizi) types.push('dz');
  if (pattern.isShunzi) types.push('sz');
  if (pattern.isZaliu) types.push('zl');
  
  // 边
  if (sumAnalysis.isXiaoBian) types.push('xb');
  if (sumAnalysis.isZhong) types.push('zhong');
  if (sumAnalysis.isDaBian) types.push('db');
  if (sumAnalysis.isBian) types.push('bian');
  
  // 龙虎合
  if (longHuHe.isLong) types.push('long');
  if (longHuHe.isHu) types.push('hu');
  if (longHuHe.isHe) types.push('he');
  
  // 和值
  types.push(String(sum).padStart(2, '0'));
  
  return types;
}

/**
 * 完整分析（一次性计算所有属性）
 * 
 * 在数据接入时调用此函数进行预计算，避免后续重复判断
 * 
 * @param opennum - 开奖号码字符串（格式：a+b+c）
 * @param sum - 和值
 * @returns 完整的分析结果，包含和值属性、形态属性、龙虎合和统计类型
 */
export function analyzeFullLotteryData(opennum: string, sum: number): LotteryAnalysis {
  const numbers = opennum.split('+').map(n => parseInt(n));
  const sumAnalysis = analyzeSumValue(sum);
  const patternAnalysis = analyzePattern(numbers);
  const longHuHeAnalysis = analyzeLongHuHe(numbers);
  const types = collectStatTypes(sum, patternAnalysis, longHuHeAnalysis);
  
  return {
    sum: sumAnalysis,
    pattern: patternAnalysis,
    longHuHe: longHuHeAnalysis,
    types
  };
}

/**
 * 从预计算数据中收集命中的统计类型
 * 
 * 统一供遗漏数据和每日统计使用，避免重复实现
 * 
 * @param data 包含预计算属性的开奖数据
 * @returns 命中的类型数组
 */
export function collectHitTypes(data: LotteryData): string[] {
  const types: string[] = [];
  
  // 大小（直接使用预计算属性）
  if (data.is_da) types.push(STAT_TYPE_KEYS.DA);
  if (data.is_xiao) types.push(STAT_TYPE_KEYS.XIAO);
  
  // 单双
  if (data.is_dan) types.push(STAT_TYPE_KEYS.DAN);
  if (data.is_shuang) types.push(STAT_TYPE_KEYS.SHUANG);
  
  // 组合
  if (data.is_da && data.is_dan) types.push(STAT_TYPE_KEYS.DD);
  if (data.is_xiao && data.is_dan) types.push(STAT_TYPE_KEYS.XD);
  if (data.is_da && data.is_shuang) types.push(STAT_TYPE_KEYS.DS);
  if (data.is_xiao && data.is_shuang) types.push(STAT_TYPE_KEYS.XS);
  
  // 极值
  if (data.is_jida) types.push(STAT_TYPE_KEYS.JD);
  if (data.is_jixiao) types.push(STAT_TYPE_KEYS.JX);
  
  // 形态
  if (data.is_baozi) types.push(STAT_TYPE_KEYS.BZ);
  if (data.is_duizi) types.push(STAT_TYPE_KEYS.DZ);
  if (data.is_shunzi) types.push(STAT_TYPE_KEYS.SZ);
  if (data.is_zaliu) types.push(STAT_TYPE_KEYS.ZL);
  
  // 边
  if (data.is_xiaobian) types.push(STAT_TYPE_KEYS.XB);
  if (data.is_zhong) types.push(STAT_TYPE_KEYS.ZHONG);
  if (data.is_dabian) types.push(STAT_TYPE_KEYS.DB);
  if (data.is_bian) types.push(STAT_TYPE_KEYS.BIAN);
  
  // 龙虎合
  if (data.is_long) types.push(STAT_TYPE_KEYS.LONG);
  if (data.is_hu) types.push(STAT_TYPE_KEYS.HU);
  if (data.is_he) types.push(STAT_TYPE_KEYS.HE);
  
  // 和值
  types.push(String(data.sum_value).padStart(2, '0'));
  
  return types;
}

