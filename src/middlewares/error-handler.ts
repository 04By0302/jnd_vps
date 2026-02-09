import { Request, Response, NextFunction } from 'express';
import { logger } from '../libs/logger';

/**
 * 统一错误处理中间件
 * 
 * 功能：
 * - 捕获所有未处理的错误
 * - 记录详细的错误信息到日志
 * - 返回统一格式的错误响应（不暴露内部细节）
 * 
 * 使用方法：
 * 在所有路由之后，作为最后一个中间件注册
 * 
 * @example
 * ```typescript
 * app.use(notFoundHandler);
 * app.use(errorHandler);
 * ```
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 记录详细错误信息
  logger.error({
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    query: req.query,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }, '请求处理失败');
  
  // 返回统一格式的错误响应（不暴露内部细节）
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'failed'
  });
}

/**
 * 常见的无效路径模式（快速拦截，避免数据库查询）
 */
const INVALID_PATH_PATTERNS = [
  /\.php$/i,           // PHP文件
  /\.asp$/i,           // ASP文件
  /\.jsp$/i,           // JSP文件
  /wp-admin/i,         // WordPress后台
  /wp-login/i,         // WordPress登录
  /phpmyadmin/i,       // phpMyAdmin
  /admin/i,            // 通用后台
  /\.env$/i,           // 环境变量文件
  /\.git/i,            // Git目录
  /\.svn/i,            // SVN目录
  /config\./i,         // 配置文件
  /backup/i,           // 备份文件
  /\.sql$/i,           // SQL文件
  /\.zip$/i,           // 压缩文件
  /\.tar/i,            // 压缩文件
  /\.bak$/i,           // 备份文件
  /xmlrpc\.php/i       // WordPress XML-RPC
  // 注意：/api/ 路径不再自动拦截，由具体路由处理404
];

/**
 * 404处理中间件（增强版）
 * 
 * 功能：
 * - 快速拦截常见的恶意扫描路径
 * - 处理所有未匹配的路由
 * - 返回统一格式的404响应
 * - 记录可疑访问日志
 * 
 * 优化：
 * - 无效路径直接返回，不查询数据库
 * - 减少日志记录（仅记录可疑路径）
 * 
 * 使用方法：
 * 在所有路由之后，errorHandler之前注册
 * 
 * @example
 * ```typescript
 * app.use(notFoundHandler);
 * ```
 */
export function notFoundHandler(req: Request, res: Response): void {
  const path = req.path;
  
  // 检查是否为常见的恶意扫描路径
  const isSuspicious = INVALID_PATH_PATTERNS.some(pattern => pattern.test(path));
  
  if (isSuspicious) {
    // 可疑路径：记录日志并快速返回
      logger.warn({
        path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('user-agent')
      }, '[拦截] 可疑访问');
    
    // 快速返回，不提供详细信息
    res.status(404).end();
    return;
  }
  
  // 正常的404（可能是用户误操作）
  res.status(404).json({
    error: '页面不存在',
    message: '请检查访问路径是否正确'
  });
}

/**
 * 异步路由错误捕获包装器
 * 
 * 功能：
 * - 自动捕获异步路由中的错误
 * - 将错误传递给errorHandler
 * 
 * 使用方法：
 * 包装所有异步路由处理函数
 * 
 * @example
 * ```typescript
 * app.get('/api/data', asyncHandler(async (req, res) => {
 *   const data = await fetchData();
 *   res.json(data);
 * }));
 * ```
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

