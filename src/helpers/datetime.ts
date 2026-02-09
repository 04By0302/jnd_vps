/**
 * 时间工具函数
 * 
 * 时区处理策略：
 * - Node.js环境：设置TZ=Asia/Shanghai
 * - Prisma连接：设置timezone=Asia/Shanghai
 * - 数据库：MySQL使用+08:00时区
 * 
 * 转换机制（补偿Prisma的UTC转换行为）：
 * - 写入数据库时：手动+8小时补偿Prisma的UTC转换
 * - 从数据库读取时：手动-8小时还原北京时间
 * - 原因：Prisma在写入时会将Date对象转为UTC，导致-8小时偏移
 * 
 * 重要说明：
 * - parseBeijingTimeString: 解析时间字符串并+8小时，用于写入数据库
 * - formatDateTime: 格式化Date对象并-8小时，用于显示输出
 * - 写入和读取的转换相互抵消，最终显示正确的北京时间
 * 
 * 注意事项：
 * - 不要单独修改写入或读取的转换逻辑，必须成对调整
 * - 修改时区处理策略需要同时调整parseBeijingTimeString和formatDateTime
 * - 所有时间相关的测试都应该验证往返转换的正确性
 */

/**
 * 获取北京时间的日期字符串（YYYY-MM-DD）
 * 
 * @returns 日期字符串，格式：YYYY-MM-DD
 * 
 * @example
 * ```typescript
 * const today = getBeijingDateString();  // "2025-12-10"
 * ```
 */
export function getBeijingDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化Date对象为日期字符串（YYYY-MM-DD）
 * 
 * @param date Date对象
 * @returns 日期字符串，格式：YYYY-MM-DD
 * 
 * @example
 * ```typescript
 * const date = new Date('2025-12-10');
 * const formatted = formatDateString(date);  // "2025-12-10"
 * ```
 */
export function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化Date对象为日期时间字符串
 * 
 * 补偿机制（读取时）：
 * - 数据库存储的Date对象在写入时被+8小时补偿过
 * - 读取时需要-8小时还原，才能正确显示北京时间
 * - 这个-8小时操作抵消了parseBeijingTimeString中的+8小时
 * 
 * 配对函数：
 * - 与parseBeijingTimeString配对使用
 * - 写入: parseBeijingTimeString (+8) → 数据库
 * - 读取: 数据库 → formatDateTime (-8) → 显示
 * 
 * @param date Date对象（从数据库读取，包含+8补偿）
 * @param includeYear 是否包含年份，默认true
 * @returns 日期时间字符串（北京时间）
 * 
 * @example
 * ```typescript
 * const date = parseBeijingTimeString('2025-12-11 05:05:00');
 * formatDateTime(date, true);   // "2025-12-11 05:05:00"
 * ```
 */
export function formatDateTime(date: Date, includeYear: boolean = true): string {
  // -8小时补偿，抵消写入时的+8小时
  const compensated = new Date(date.getTime() - 8 * 60 * 60 * 1000);
  
  const year = compensated.getFullYear();
  const month = String(compensated.getMonth() + 1).padStart(2, '0');
  const day = String(compensated.getDate()).padStart(2, '0');
  const hour = String(compensated.getHours()).padStart(2, '0');
  const minute = String(compensated.getMinutes()).padStart(2, '0');
  const second = String(compensated.getSeconds()).padStart(2, '0');
  
  if (includeYear) {
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  } else {
    return `${month}-${day} ${hour}:${minute}:${second}`;
  }
}

/**
 * 格式化当前时间为时间字符串（HH:mm:ss）
 * 
 * @returns 时间字符串，格式：HH:mm:ss
 * 
 * @example
 * ```typescript
 * const timeStr = getCurrentTimeString();  // "15:30:45"
 * ```
 */
export function getCurrentTimeString(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * 将时间字符串转换为Date对象（用于写入数据库）
 * 
 * 补偿机制（写入时）：
 * - Prisma在写入MySQL时会提取Date对象的UTC时间部分
 * - 如果不补偿，UTC时间会比北京时间少8小时
 * - 通过手动+8小时，让UTC部分存储的是北京时间的数值
 * 
 * 工作原理：
 * - 输入: "2025-12-11 05:05:00" (北京时间字符串)
 * - 解析: Date对象(本地时间05:05, UTC时间21:05前一天)
 * - 补偿: +8小时 → Date对象(UTC时间05:05)
 * - Prisma: 提取UTC部分 → MySQL存储05:05 ✓
 * 
 * 配对函数：
 * - 与formatDateTime配对使用
 * - 写入: parseBeijingTimeString (+8) → 数据库
 * - 读取: 数据库 → formatDateTime (-8) → 显示
 * 
 * @param timeString 时间字符串，格式：YYYY-MM-DD HH:mm:ss（北京时间）
 * @returns Date对象（已补偿+8小时，用于写入数据库）
 */
export function parseBeijingTimeString(timeString: string): Date {
  // 将 YYYY-MM-DD 替换为 YYYY/MM/DD 以确保浏览器兼容性
  const normalizedString = timeString.replace(/-/g, '/');
  const date = new Date(normalizedString);
  
  // +8小时补偿Prisma的UTC转换行为
  // 这样Prisma发送的UTC时间就是正确的北京时间值
  return new Date(date.getTime() + 8 * 60 * 60 * 1000);
}

/**
 * 获取当前时间的Date对象（用于写入数据库）
 * 
 * 补偿机制：
 * - 对当前时间进行+8小时补偿
 * - 让Date对象的UTC部分存储北京时间的数值
 * - Prisma写入时会提取UTC部分，从而存储正确的北京时间
 * 
 * 使用场景：
 * - 写入created_at、updated_at等时间戳字段
 * - 需要配合formatDateTime读取显示
 * 
 * @returns Date对象（已补偿+8小时，用于写入数据库）
 */
export function getBeijingDate(): Date {
  const now = new Date();
  // +8小时补偿：让UTC部分存储北京时间数值
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

