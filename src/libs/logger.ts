import { config } from '../config';

/**
 * 简化的日志工具（无emoji，纯中文，UTF-8兼容）
 * 
 * 不使用 pino，直接输出到控制台
 * 确保 Windows PowerShell 中文正常显示
 */

// 日志级别
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
} as const;

// 当前日志级别
const currentLevel = LOG_LEVELS[config.app.logLevel as keyof typeof LOG_LEVELS] || LOG_LEVELS.info;

// 格式化时间
function formatTime(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

// 格式化日志对象
function formatObject(obj: any): string {
  if (!obj || typeof obj !== 'object') return '';
  try {
    return ' ' + JSON.stringify(obj);
  } catch {
    return '';
  }
}

// 日志输出函数
function log(level: string, message: string, data?: any): void {
  const time = formatTime();
  const dataStr = data ? formatObject(data) : '';
  const output = `[${time}] ${level}: ${message}${dataStr}`;
  console.log(output);
}

// 导出日志接口
export const logger = {
  debug(message: string | any, data?: any): void {
    if (currentLevel <= LOG_LEVELS.debug) {
      if (typeof message === 'object') {
        log('DEBUG', '', message);
      } else {
        log('DEBUG', message, data);
      }
    }
  },

  info(message: string | any, data?: any): void {
    if (currentLevel <= LOG_LEVELS.info) {
      if (typeof message === 'object') {
        log('INFO', '', message);
      } else {
        log('INFO', message, data);
      }
    }
  },

  warn(message: string | any, data?: any): void {
    if (currentLevel <= LOG_LEVELS.warn) {
      if (typeof message === 'object') {
        log('WARN', '', message);
      } else {
        log('WARN', message, data);
      }
    }
  },

  error(message: string | any, data?: any): void {
    if (currentLevel <= LOG_LEVELS.error) {
      if (typeof message === 'object') {
        log('ERROR', '', message);
      } else {
        log('ERROR', message, data);
      }
    }
  }
};

