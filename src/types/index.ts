/**
 * 核心类型定义
 */

/**
 * 基础开奖数据（数据源解析后的原始数据）
 * 
 * 来自数据源解析器的原始开奖数据，未包含预计算字段
 */
export interface BaseLotteryData {
  qihao: string;           // 期号
  opentime: string;        // 开奖时间
  opennum: string;         // 开奖号码（格式：a+b+c）
  sum_value: number;       // 和值
  source: string;          // 数据来源
}

/**
 * 完整开奖数据（包含预计算属性）
 * 
 * 在 BaseLotteryData 基础上添加了预计算的统计属性
 * 预计算字段在数据写入时一次性计算，避免后续重复计算
 */
export interface LotteryData extends BaseLotteryData {
  // 大小属性（互斥）
  is_da: boolean;          // 大：和值 >= 14
  is_xiao: boolean;        // 小：和值 <= 13
  
  // 单双属性（互斥）
  is_dan: boolean;         // 单：和值为奇数
  is_shuang: boolean;      // 双：和值为偶数
  
  // 极值属性（独立，可能都为 false）
  is_jida: boolean;        // 极大：和值 >= 22
  is_jixiao: boolean;      // 极小：和值 <= 5
  
  // 组合属性（枚举值：大单/小单/大双/小双）
  combination: string;     // 组合类型
  
  // 形态属性（互斥，有且仅有一个为 true）
  is_baozi: boolean;       // 豹子：三个数字相同（如5+5+5）
  is_duizi: boolean;       // 对子：两个数字相同（如3+3+7）
  is_shunzi: boolean;      // 顺子：三个连续数字（如2+3+4）
  is_zaliu: boolean;       // 杂六：其他情况
  
  // 边属性（根据和值范围）
  is_xiaobian: boolean;    // 小边：和值 0-9
  is_zhong: boolean;       // 中：和值 10-17
  is_dabian: boolean;      // 大边：和值 18-27
  is_bian: boolean;        // 边：小边或大边（和值 0-9 或 18-27）
  
  // 龙虎合属性（根据第一个和第三个号码比较）
  is_long: boolean;        // 龙：num1 > num3
  is_hu: boolean;          // 虎：num1 < num3
  is_he: boolean;          // 合：num1 = num3
}

// 数据库记录类型（从数据库查询出来的）
export interface LotteryRecord {
  id: number;
  qihao: string;
  opentime: Date;
  opennum: string;
  sum_value: number;
  source: string;
  created_at: Date;
  updated_at: Date;
}

// 数据源配置
export interface DataSourceConfig {
  name: string;
  url: string;
  interval: number;        // 抓取间隔（毫秒）
  parser: (data: any) => BaseLotteryData | null;  // 解析器返回基础数据，预计算由writer处理
  skipSSL?: boolean;       // 是否跳过SSL验证
  headers?: Record<string, string>;  // 自定义请求头
}

// 缓存Key枚举
export enum CacheKeys {
  LOCK_PREFIX = 'project:lock:issue:',
  SEEN_PREFIX = 'project:seen:issue:',
  JSON_KJ = 'project:api:kj',
  JSON_YL = 'project:api:yl',
  JSON_YK = 'project:api:yk',
  JSON_DS = 'project:api:ds',
  JSON_DX = 'project:api:dx',
  JSON_ZH = 'project:api:zh',
  JSON_SHA = 'project:api:sha',
  LAST_ISSUE = 'project:last:issue',
  PREDICT_LOCK = 'project:predict:lock:'
}

// 校验结果
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// 遗漏数据统计
export interface YiLouData {
  da: number;      // 大（14-27）
  xiao: number;    // 小（0-13）
  dan: number;     // 单
  shuang: number;  // 双
  dd: number;      // 大单
  xd: number;      // 小单
  ds: number;      // 大双
  xs: number;      // 小双
  jd: number;      // 极大（22-27）
  jx: number;      // 极小（0-5）
  dz: number;      // 对子
  sz: number;      // 顺子
  bz: number;      // 豹子
  zl: number;      // 杂六
  xb: number;      // 小边（0-9）
  zhong: number;   // 中（10-17）
  db: number;      // 大边（18-27）
  bian: number;    // 边（小边+大边）
  long: number;    // 龙（num1 > num3）
  hu: number;      // 虎（num1 < num3）
  he: number;      // 合（num1 = num3）
  [key: string]: number;  // 00-27的遗漏值
}

// 已开数据统计
export interface YiKaiData {
  da: number;
  xiao: number;
  dan: number;
  shuang: number;
  dd: number;
  xd: number;
  ds: number;
  xs: number;
  jd: number;
  jx: number;
  dz: number;
  sz: number;
  bz: number;
  zl: number;      // 杂六
  xb: number;      // 小边（0-9）
  zhong: number;   // 中（10-17）
  db: number;      // 大边（18-27）
  bian: number;    // 边（小边+大边）
  long: number;    // 龙（num1 > num3）
  hu: number;      // 虎（num1 < num3）
  he: number;      // 合（num1 = num3）
  [key: string]: number;  // 00-27的出现次数
}

// JSON输出格式
export interface KjJsonOutput {
  data: Array<{
    qihao: string;
    opentime: string;
    opennum: string;
    sum: string;
  }>;
  message: string;
}

export interface YlJsonOutput {
  data: YiLouData;
  message: string;
}

export interface YkJsonOutput {
  data: YiKaiData;
  message: string;
}

// AI预测类型
export enum PredictType {
  DANSHUANG = 'danshuang',
  DAXIAO = 'daxiao',
  COMBINATION = 'combination',
  KILL = 'kill'
}

// AI预测数据
export interface PredictData {
  qihao: string;
  predict: string;
  opennum: string | null;
  sum: string | null;
  result: string | null;
  hit: boolean | null;
}

// AI预测JSON输出
export interface PredictJsonOutput {
  type: string;
  data: PredictData[];
  message: string;
}

// AI预测数据库记录
export interface PredictRecord {
  id: number;
  qihao: string;
  predict_type: string;
  predict_value: string;
  opennum: string | null;
  sum_value: number | null;
  result_value: string | null;
  hit: boolean | null;
  created_at: Date;
  updated_at: Date;
}

