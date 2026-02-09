/**
 * Redis缓存键构建器
 * 
 * 统一管理所有缓存键的命名规则
 * 
 * 命名规范：
 * - 所有缓存键统一使用 `project:` 前缀（符合项目规则第6条）
 * - 格式：project:<模块>:<类型>:<参数>
 * 
 * 缓存TTL策略（统一180秒）：
 * - 锁键：3秒（特殊，防止死锁）
 * - 去重键：3600秒（1小时，防止重复处理）
 * - 数据缓存键：180秒（统一标准）
 * - 胜率键：300秒（5分钟）
 * 
 * 缓存清除策略：
 * - 锁和去重键：TTL自动过期，无需手动清除
 * - 数据缓存键（kj、预测、Excel）：新数据写入时由cache-manager统一清除
 * - 胜率键：主动更新值，不清除
 */
export class CacheKeyBuilder {
  /** 统一的缓存键前缀 */
  private static readonly PREFIX = 'project:';
  
  /**
   * 构建带前缀的缓存键
   * @param key 键名
   * @returns 带前缀的完整键名
   */
  private static buildKey(key: string): string {
    return `${this.PREFIX}${key}`;
  }
  /**
   * 锁相关键
   * 
   * 用途：防止同一期号被多个数据源重复写入
   * TTL：3秒自动过期
   * 清除：无需手动清除，依赖TTL
   */
  static lockKey(issue: string): string {
    return this.buildKey(`lock:issue:${issue}`);
  }
  
  /**
   * 去重相关键
   * 
   * 用途：标记某期号已处理，防止重复处理
   * TTL：永久保存
   * 清除：无需清除
   */
  static seenKey(issue: string): string {
    return this.buildKey(`seen:issue:${issue}`);
  }
  
  /**
   * 开奖数据API缓存键
   * 
   * 用途：缓存/kj.json API的响应数据
   * TTL：180秒
   * 清除：新数据写入时，cache-manager清除所有project:kj:limit:*
   */
  static kjLimitKey(limit: number): string {
    return this.buildKey(`kj:limit:${limit}`);
  }
  
  /**
   * 遗漏统计API缓存键
   * 
   * 用途：缓存/yl.json API的响应数据
   * TTL：180秒
   * 清除：新数据写入时，cache-manager清除project:yl缓存
   */
  static ylKey(): string {
    return this.buildKey('yl');
  }
  
  /**
   * 已开统计API缓存键
   * 
   * 用途：缓存/yk.json API的响应数据
   * TTL：180秒
   * 清除：新数据写入时，cache-manager清除project:yk缓存
   */
  static ykKey(): string {
    return this.buildKey('yk');
  }
  
  /**
   * Excel导出缓存键 - 开奖数据
   * 
   * 用途：缓存开奖数据Excel文件Buffer
   * TTL：180秒（统一标准）
   * 清除：新数据写入时，cache-manager清除所有project:excel:lottery:*
   */
  static excelLotteryKey(limit: number): string {
    return this.buildKey(`excel:lottery:${limit}`);
  }
  
  /**
   * Excel导出缓存键 - 统计数据
   * 
   * 用途：缓存统计数据Excel文件Buffer
   * TTL：180秒（统一标准）
   * 清除：新数据写入时，cache-manager清除所有project:excel:stats:*
   */
  static excelStatsKey(days: number): string {
    return this.buildKey(`excel:stats:${days}`);
  }
  
  /**
   * 预测锁键
   * 
   * 用途：防止同一期号的预测被重复触发
   * TTL：30秒自动过期
   * 清除：无需手动清除，依赖TTL
   */
  static predictLockKey(qihao: string): string {
    return this.buildKey(`predict:lock:${qihao}`);
  }
  
  /**
   * 胜率统计键
   * 
   * 用途：缓存预测胜率统计数据
   * TTL：永久保存
   * 清除：不清除，而是在新预测生成时主动更新值
   */
  static winrateKey(type: string): string {
    return this.buildKey(`winrate:${type}`);
  }
  
  /**
   * 最后期号键
   * 
   * 用途：记录最后处理的期号，用于断点续传
   * TTL：永久保存
   * 清除：无需清除
   */
  static lastIssueKey(): string {
    return this.buildKey('last:issue');
  }
  
  /**
   * 今日统计已处理期号标记
   * 
   * 用途：标记某期号已进入今日统计，防止重复统计
   * TTL：当天有效（自动过期）
   * 清除：重建统计时批量清除
   */
  static todayStatsProcessedKey(date: string, qihao: string): string {
    return this.buildKey(`today_stats:processed:${date}:${qihao}`);
  }

  /**
   * 今日统计已处理期号清除模式
   */
  static todayStatsProcessedPattern(date: string): string {
    return this.buildKey(`today_stats:processed:${date}:*`);
  }

  /**
   * 预测数据API缓存键
   * 
   * 用途：缓存预测API的响应数据（ds、dx、zh、sha）
   * TTL：180秒（统一标准）
   * 清除：新预测生成时，cache-manager清除所有project:predict:*:limit:*
   */
  static predictLimitKey(type: string, limit: number): string {
    return this.buildKey(`predict:${type}:limit:${limit}`);
  }

  // ========== 缓存清除模式（用于cache-manager） ==========
  
  /**
   * 开奖数据缓存清除模式
   */
  static kjLimitPattern(): string {
    return this.buildKey('kj:limit:*');
  }


  /**
   * 预测数据缓存清除模式
   */
  static predictPattern(): string {
    return this.buildKey('predict:*:limit:*');
  }

  /**
   * Excel开奖数据缓存清除模式
   */
  static excelLotteryPattern(): string {
    return this.buildKey('excel:lottery:*');
  }

  /**
   * Excel统计数据缓存清除模式
   */
  static excelStatsPattern(): string {
    return this.buildKey('excel:stats:*');
  }
}



