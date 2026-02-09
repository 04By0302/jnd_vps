/**
 * SEO友好的HTTP响应头中间件
 * 添加搜索引擎优化相关的HTTP头
 */

import { Request, Response, NextFunction } from 'express';

/**
 * 全局SEO响应头
 * 为所有响应添加SEO友好的HTTP头
 */
export function globalSeoHeaders(_req: Request, res: Response, next: NextFunction): void {
  // 基础SEO头
  res.setHeader('Content-Language', 'zh-CN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // 安全头（有助于搜索引擎信任度）
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  // CORS头（允许搜索引擎爬取API）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, Cache-Control, Content-Type');
  
  next();
}

/**
 * JSON API响应头
 * 为JSON API添加特定的响应头
 */
export function jsonApiHeaders(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json;
  
  res.json = function(data: any): Response {
    // 明确内容类型
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    
    // 添加API版本头（可选，有助于API文档索引）
    res.setHeader('X-API-Version', '1.0');
    
    // 添加自定义头标识
    res.setHeader('X-Powered-By', 'PC28-API-System');
    
    return originalJson.call(this, data);
  };
  
  next();
}

/**
 * Sitemap响应头
 * 为sitemap.xml添加特定的响应头
 */
export function sitemapHeaders(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/sitemap.xml') {
    // XML内容类型
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    
    // 缓存控制（每天更新一次）
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    
    // 最后修改时间
    const now = new Date();
    res.setHeader('Last-Modified', now.toUTCString());
  }
  
  next();
}

/**
 * Robots.txt响应头
 * 为robots.txt添加特定的响应头
 */
export function robotsHeaders(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/robots.txt') {
    // 文本内容类型
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    
    // 长期缓存（robots.txt变化不频繁）
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=604800');
  }
  
  next();
}

/**
 * 健康检查响应头
 * 为/health端点添加特定响应头
 */
export function healthCheckHeaders(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') {
    // 禁止缓存健康检查结果
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  next();
}

/**
 * 组合所有SEO相关的中间件
 * 按顺序应用所有SEO响应头
 */
export function applySeoMiddleware(req: Request, res: Response, next: NextFunction): void {
  globalSeoHeaders(req, res, () => {
    sitemapHeaders(req, res, () => {
      robotsHeaders(req, res, () => {
        healthCheckHeaders(req, res, () => {
          jsonApiHeaders(req, res, next);
        });
      });
    });
  });
}

