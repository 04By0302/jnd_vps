import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * HTTP缓存头中间件
 * 为不同类型的资源设置适当的缓存策略
 * 同时添加SEO友好的HTTP响应头
 */

/**
 * 生成ETag
 */
function generateETag(content: string | Buffer): string {
  return crypto
    .createHash('md5')
    .update(content)
    .digest('hex')
    .substring(0, 16);
}

/**
 * 动态JSON文件缓存头（高实时性）
 * 适用于：kj.json, ds.json, dx.json, zh.json, sha.json
 * 
 * 优化说明：
 * - max-age=60: 浏览器缓存60秒，快速响应且不会过期太久
 * - s-maxage=120: CDN缓存120秒，减轻服务器压力
 * - must-revalidate: 过期后必须重新验证
 * - stale-while-revalidate=30: 过期后30秒内返回旧数据同时后台刷新
 */
export function dynamicJsonCache(req: Request, res: Response, next: NextFunction): void {
  const originalSend = res.send;
  
  res.send = function(data: any): Response {
    if (res.getHeader('Content-Type')?.toString().includes('application/json')) {
      // 设置缓存头（区分浏览器和CDN）
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, must-revalidate, stale-while-revalidate=30');
      
      // 生成ETag
      if (data) {
        const etag = generateETag(typeof data === 'string' ? data : JSON.stringify(data));
        res.setHeader('ETag', `"${etag}"`);
        
        // 检查If-None-Match
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch === `"${etag}"`) {
          res.status(304);
          return originalSend.call(this, '');
        }
      }
    }
    
    return originalSend.call(this, data);
  };
  
  next();
}

/**
 * 半动态JSON文件缓存头（中等实时性）
 * 适用于：yl.json, yk.json
 * 
 * 优化说明：
 * - max-age=60: 浏览器缓存60秒
 * - s-maxage=120: CDN缓存120秒
 * - must-revalidate: 过期后必须重新验证
 */
export function semiDynamicJsonCache(_req: Request, res: Response, next: NextFunction): void {
  const originalSendFile = res.sendFile.bind(res);
  
  // @ts-ignore - 重写sendFile方法
  res.sendFile = function(path: string, options?: any, callback?: any): any {
    // 设置缓存头（区分浏览器和CDN）
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, must-revalidate');
    
    if (callback) {
      return originalSendFile(path, options, callback);
    } else if (options) {
      return originalSendFile(path, options);
    } else {
      return originalSendFile(path);
    }
  };
  
  next();
}

/**
 * 静态HTML缓存头
 * 适用于：index.html, history.html
 * 
 * 优化说明：
 * - HTML文件缓存时间较短（60秒），便于快速更新前端
 * - CDN缓存300秒（5分钟），减轻服务器压力
 * - 添加SEO友好的HTTP响应头
 */
export function staticHtmlCache(req: Request, res: Response, next: NextFunction): void {
  // 仅对HTML文件应用
  if (req.path.endsWith('.html') || req.path === '/') {
    // 缓存控制
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, must-revalidate');
    
    // SEO友好的HTTP头
    res.setHeader('Content-Language', 'zh-CN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  }
  
  next();
}

/**
 * API响应缓存控制
 * 为API接口添加适当的缓存头
 */
export function apiCacheControl(maxAge: number = 60) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const originalJson = res.json;
    
    res.json = function(data: any): Response {
      // 设置缓存头
      res.setHeader('Cache-Control', `public, max-age=${maxAge}, must-revalidate`);
      
      // 生成ETag
      const etag = generateETag(JSON.stringify(data));
      res.setHeader('ETag', `"${etag}"`);
      
      // 检查If-None-Match
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch === `"${etag}"`) {
        res.status(304);
        return originalJson.call(this, {});
      }
      
      return originalJson.call(this, data);
    };
    
    next();
  };
}

