/**
 * 统计类型常量配置
 * 作为所有统计相关逻辑的单一数据源
 */

// 基础统计类型定义
export const STAT_TYPE_KEYS = {
  // 大小
  DA: 'da',
  XIAO: 'xiao',
  // 单双
  DAN: 'dan',
  SHUANG: 'shuang',
  // 组合
  DD: 'dd',  // 大单
  XD: 'xd',  // 小单
  DS: 'ds',  // 大双
  XS: 'xs',  // 小双
  // 极值
  JD: 'jd',  // 极大
  JX: 'jx',  // 极小
  // 形态
  DZ: 'dz',  // 对子
  SZ: 'sz',  // 顺子
  BZ: 'bz',  // 豹子
  ZL: 'zl',  // 杂六
  // 边
  XB: 'xb',     // 小边（0-9）
  ZHONG: 'zhong',  // 中（10-17）
  DB: 'db',     // 大边（18-27）
  BIAN: 'bian', // 边（小边+大边）
  // 龙虎合
  LONG: 'long', // 龙（num1 > num3）
  HU: 'hu',     // 虎（num1 < num3）
  HE: 'he'      // 合（num1 = num3）
} as const;

// 所有基础类型列表（按显示顺序）
export const BASE_STAT_TYPES = [
  STAT_TYPE_KEYS.DA,
  STAT_TYPE_KEYS.XIAO,
  STAT_TYPE_KEYS.DAN,
  STAT_TYPE_KEYS.SHUANG,
  STAT_TYPE_KEYS.DD,
  STAT_TYPE_KEYS.XD,
  STAT_TYPE_KEYS.DS,
  STAT_TYPE_KEYS.XS,
  STAT_TYPE_KEYS.JD,
  STAT_TYPE_KEYS.JX,
  STAT_TYPE_KEYS.DZ,
  STAT_TYPE_KEYS.SZ,
  STAT_TYPE_KEYS.BZ,
  STAT_TYPE_KEYS.ZL,
  STAT_TYPE_KEYS.XB,
  STAT_TYPE_KEYS.ZHONG,
  STAT_TYPE_KEYS.DB,
  STAT_TYPE_KEYS.BIAN,
  STAT_TYPE_KEYS.LONG,
  STAT_TYPE_KEYS.HU,
  STAT_TYPE_KEYS.HE
] as const;

// 和值类型生成器
export function getSumValueTypes(): string[] {
  return Array.from({ length: 28 }, (_, i) => String(i).padStart(2, '0'));
}

// 所有统计类型（基础类型 + 和值类型）
export function getAllStatTypes(): string[] {
  return [...BASE_STAT_TYPES, ...getSumValueTypes()];
}

// 创建空统计对象
export function createEmptyStatObject(): Record<string, number> {
  const stats: Record<string, number> = {};
  
  // 初始化基础类型
  for (const type of BASE_STAT_TYPES) {
    stats[type] = 0;
  }
  
  // 初始化和值类型
  for (const sumType of getSumValueTypes()) {
    stats[sumType] = 0;
  }
  
  return stats;
}



