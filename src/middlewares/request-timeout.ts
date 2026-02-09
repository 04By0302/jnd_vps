import { Request, Response, NextFunction } from 'express';
import { logger } from '../libs/logger';

/**
 * 请求超时中间件
 * 
 * 功能：
 * - 防止慢请求长时间占用数据库连接
 * - 自动中断超时请求
 * - 记录超时日志用于分析
 * 
 * 超时策略：
 * - 普通API：30秒
 * - Excel导出：60秒（大数据量）
 * - 健康检查：5秒
 */

const TIMEOUT_CONFIG = {
  default: 30000,      // 默认30秒
  export: 60000,       // 导出60秒
  health: 5000         // 健康检查5秒
};

/**
 * 请求超时中间件
 */
export function requestTimeout(req: Request, res: Response, next: NextFunction): void {
  // 根据路径设置不同的超时时间
  let timeout = TIMEOUT_CONFIG.default;
  
  if (req.path.startsWith('/api/export/')) {
    timeout = TIMEOUT_CONFIG.export;
  } else if (req.path === '/health') {
    timeout = TIMEOUT_CONFIG.health;
  }
  
  // 设置超时定时器
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      logger.warn({
        path: req.path,
        method: req.method,
        ip: req.ip,
        timeout: timeout,
        userAgent: req.get('user-agent')
      }, `[超时] 请求超时: ${req.method} ${req.path} (${timeout}ms)`);
      
      res.status(408).json({
        error: '请求超时',
        message: '服务器处理时间过长，请稍后重试',
        timeout: `${timeout}ms`
      });
    }
  }, timeout);
  
  // 请求完成时清除定时器
  res.on('finish', () => {
    clearTimeout(timer);
  });
  
  // 连接关闭时清除定时器
  res.on('close', () => {
    clearTimeout(timer);
  });
  
  next();
}

/**
 * 数据库操作超时包装器
 * 
 * 用于包装数据库查询，确保不会无限期占用连接
 * 
 * @param operation 数据库操作
 * @param timeoutMs 超时时间（毫秒）
 * @param operationName 操作名称（用于日志）
 * @returns 操作结果
 */
export async function withDatabaseTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = 30000,
  operationName: string = '数据库操作'
): Promise<T> {
  return Promise.race([
    operation(),
    new Promise<T>((_, reject) => 
      setTimeout(() => {
        const error = new Error(`${operationName}超时 (${timeoutMs}ms)`);
        (error as any).code = 'OPERATION_TIMEOUT';
        reject(error);
      }, timeoutMs)
    )
  ]);
}

