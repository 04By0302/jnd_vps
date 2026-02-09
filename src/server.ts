import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { config } from './config';
import { readDB } from './database/client';
import { exportLotteryDataToExcel, exportStatsDataToExcel } from './services/excel-export';
import { formatDateTime } from './helpers/datetime';
import { CacheKeyBuilder } from './libs/cache-keys';

/**
 * HTTP服务器，提供前端页面和JSON API
 */
export class WebServer {
  private app: express.Application;
  private port: number;

  constructor(port: number = 9797) {
    this.app = express();
    this.port = port;
    this.setupRoutes();
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 导入中间件
    const { staticHtmlCache } = require('./middlewares/cache-headers');
    const { requestTimeout } = require('./middlewares/request-timeout');
    const { applySeoMiddleware } = require('./middlewares/seo-headers');
    
    // 1. SEO友好的HTTP响应头（全局，最优先）
    this.app.use(applySeoMiddleware);
    
    // 2. 请求超时保护（防止慢请求占用连接）
    this.app.use(requestTimeout);
    
    // 4. 应用HTML缓存头中间件
    this.app.use(staticHtmlCache);
    
    // 5. 静态文件服务 - 前端页面（不限流）
    this.app.use(express.static(path.join(__dirname, '../public')));

    // 首页路由
    this.app.get('/', (_req, res) => {
      res.sendFile(path.resolve(__dirname, '../public/index.html'));
    });

    // JSON API 路由
    const outputDir = path.resolve(config.output.dir);

    // 最新开奖数据 - 支持limit参数（带Redis缓存）
    this.app.get('/kj.json', async (req, res): Promise<void> => {
      try {
        const limit = parseInt(req.query.limit as string) || 1;
        const validLimit = Math.min(Math.max(1, limit), 100); // 限制1-100
        
        const { getRedisClient } = await import('./libs/redis');
        const redis = getRedisClient();
        const cacheKey = CacheKeyBuilder.kjLimitKey(validLimit);
        
        // 尝试从Redis获取缓存
        const cached = await redis.get(cacheKey);
        if (cached) {
          res.setHeader('X-Cache', 'HIT');
          res.json(JSON.parse(cached));
          return;
        }
        
        // 缓存未命中，查询数据库
        const records = await readDB.latest_lottery_data.findMany({
          orderBy: { opentime: 'desc' },
          take: validLimit
        });
        
        const output = {
          data: records.map((r: any) => ({
            qihao: r.qihao,
            opentime: formatDateTime(r.opentime, false),
            opennum: r.opennum,
            sum: String(r.sum_value)
          })),
          message: 'success'
        };
        
        // 写入缓存（180秒TTL）
        await redis.setex(cacheKey, config.cache.dataTTL, JSON.stringify(output));
        res.setHeader('X-Cache', 'MISS');
        res.json(output);
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal Server Error', message: 'success' });
        }
      }
    });

    // 遗漏统计（带缓存头 + ETag）
    this.app.get('/yl.json', async (_req, res): Promise<void> => {
      try {
        const filePath = path.resolve(outputDir, 'yl.json');
        const stat = await fs.stat(filePath);
        const etag = `"${stat.mtime.getTime()}"`;
        
        // 浏览器缓存60秒，CDN缓存120秒
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, must-revalidate');
        res.setHeader('ETag', etag);
        
        // 检查If-None-Match
        if (_req.headers['if-none-match'] === etag) {
          res.status(304).end();
          return;
        }
        
        res.sendFile(filePath);
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'File not found' });
        }
      }
    });

    // 已开统计（带缓存头 + ETag）
    this.app.get('/yk.json', async (_req, res): Promise<void> => {
      try {
        const filePath = path.resolve(outputDir, 'yk.json');
        const stat = await fs.stat(filePath);
        const etag = `"${stat.mtime.getTime()}"`;
        
        // 浏览器缓存60秒，CDN缓存120秒
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, must-revalidate');
        res.setHeader('ETag', etag);
        
        // 检查If-None-Match
        if (_req.headers['if-none-match'] === etag) {
          res.status(304).end();
          return;
        }
        
        res.sendFile(filePath);
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'File not found' });
        }
      }
    });

    // AI预测接口（支持limit参数，默认10条，最大100条）
    // 单双预测
    this.app.get('/ds.json', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit as string) || 10;
        const validLimit = Math.min(Math.max(1, limit), 100);
        
        const { getPredictDataWithCache } = await import('./services/predict-cache');
        const { PredictType } = await import('./types');
        
        const data = await getPredictDataWithCache(PredictType.DANSHUANG, validLimit);
        
        res.setHeader('X-Cache', data.length > 0 ? 'HIT' : 'MISS');
        res.json({
          type: 'danshuang',
          data,
          message: 'success'
        });
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal Server Error', message: 'success' });
        }
      }
    });

    // 大小预测
    this.app.get('/dx.json', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit as string) || 10;
        const validLimit = Math.min(Math.max(1, limit), 100);
        
        const { getPredictDataWithCache } = await import('./services/predict-cache');
        const { PredictType } = await import('./types');
        
        const data = await getPredictDataWithCache(PredictType.DAXIAO, validLimit);
        
        res.setHeader('X-Cache', data.length > 0 ? 'HIT' : 'MISS');
        res.json({
          type: 'daxiao',
          data,
          message: 'success'
        });
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal Server Error', message: 'success' });
        }
      }
    });

    // 组合预测
    this.app.get('/zh.json', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit as string) || 10;
        const validLimit = Math.min(Math.max(1, limit), 100);
        
        const { getPredictDataWithCache } = await import('./services/predict-cache');
        const { PredictType } = await import('./types');
        
        const data = await getPredictDataWithCache(PredictType.COMBINATION, validLimit);
        
        res.setHeader('X-Cache', data.length > 0 ? 'HIT' : 'MISS');
        res.json({
          type: 'combination',
          data,
          message: 'success'
        });
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal Server Error', message: 'success' });
        }
      }
    });

    // 杀组合预测
    this.app.get('/sha.json', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit as string) || 10;
        const validLimit = Math.min(Math.max(1, limit), 100);
        
        const { getPredictDataWithCache } = await import('./services/predict-cache');
        const { PredictType } = await import('./types');
        
        const data = await getPredictDataWithCache(PredictType.KILL, validLimit);
        
        res.setHeader('X-Cache', data.length > 0 ? 'HIT' : 'MISS');
        res.json({
          type: 'kill',
          data,
          message: 'success'
        });
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal Server Error', message: 'success' });
        }
      }
    });


    // 胜率统计API（从Redis缓存读取，不查数据库）
    this.app.get('/api/winrate/:type', async (req, res) => {
      try {
        const type = req.params.type;
        const validTypes = ['danshuang', 'daxiao', 'combination', 'kill'];
        
        if (!validTypes.includes(type)) {
          res.status(400).json({ error: 'Invalid prediction type' });
          return;
        }
        
        // 从Redis读取缓存（后端每次新开奖时自动更新）
        const redis = (await import('./libs/redis')).getRedisClient();
        const cached = await redis.get(CacheKeyBuilder.winrateKey(type));
        
        if (cached) {
          res.json(JSON.parse(cached));
        } else {
          // 缓存miss，返回默认值
          res.json({
            type,
            total: 0,
            hits: 0,
            misses: 0,
            winRate: '0.00',
            message: 'success'
          });
        }
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal Server Error', message: 'failed' });
        }
      }
    });

    // 历史数据页面
    this.app.get('/history.html', (_req, res) => {
      res.sendFile(path.resolve(__dirname, '../public/history.html'));
    });

    // 历史开奖数据导出API（带缓存和并发控制）
    this.app.get('/api/export/lottery', async (req, res) => {
      const { exportLimiter, checkExcelCache, setExcelCache } = await import('./middlewares/export-limiter');
      
      // 应用并发控制
      exportLimiter(req, res, async () => {
        try {
          const limit = parseInt(req.query.limit as string) || 30;
          const validLimit = Math.min(Math.max(1, limit), 30000);
          
          const cacheKey = CacheKeyBuilder.excelLotteryKey(validLimit);
          
          // 检查缓存
          let buffer = await checkExcelCache(cacheKey);
          
          if (buffer) {
            // 缓存命中
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=lottery_data_${validLimit}.xlsx`);
            res.send(buffer);
            return;
          }
          
          // 缓存未命中，生成Excel
          const excelBuffer = await exportLotteryDataToExcel(validLimit);
          buffer = Buffer.from(excelBuffer as ArrayBuffer);
          
          // 写入缓存（使用配置的TTL）
          await setExcelCache(cacheKey, buffer, config.cache.dataTTL);
          
          res.setHeader('X-Cache', 'MISS');
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename=lottery_data_${validLimit}.xlsx`);
          res.send(buffer);
        } catch (error) {
          if (!res.headersSent) {
            res.status(500).json({ error: 'Export failed' });
          }
        }
      });
    });

    // 历史统计数据导出API（带缓存和并发控制）
    this.app.get('/api/export/stats', async (req, res) => {
      const { exportLimiter, checkExcelCache, setExcelCache } = await import('./middlewares/export-limiter');
      
      // 应用并发控制
      exportLimiter(req, res, async () => {
        try {
          const days = parseInt(req.query.days as string) || 7;
          const validDays = Math.min(Math.max(1, days), 90);
          
          const cacheKey = CacheKeyBuilder.excelStatsKey(validDays);
          
          // 检查缓存
          let buffer = await checkExcelCache(cacheKey);
          
          if (buffer) {
            // 缓存命中
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=stats_data_${validDays}days.xlsx`);
            res.send(buffer);
            return;
          }
          
          // 缓存未命中，生成Excel
          const excelBuffer = await exportStatsDataToExcel(validDays);
          buffer = Buffer.from(excelBuffer as ArrayBuffer);
          
          // 写入缓存（使用配置的TTL）
          await setExcelCache(cacheKey, buffer, config.cache.dataTTL);
          
          res.setHeader('X-Cache', 'MISS');
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename=stats_data_${validDays}days.xlsx`);
          res.send(buffer);
        } catch (error) {
          if (!res.headersSent) {
            res.status(500).json({ error: 'Export failed' });
          }
        }
      });
    });

    // 健康检查（增强版 - 包含数据库和Redis状态）
    this.app.get('/health', async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      
      try {
        const { getDatabaseHealth } = await import('./database/client');
        const { getRedisHealthStatus } = await import('./libs/redis');
        
        const dbHealth = getDatabaseHealth();
        const redisHealthy = getRedisHealthStatus();
        
        // 判断整体健康状态
        let overallStatus = 'healthy';
        if (dbHealth.status === 'critical' || !redisHealthy) {
          overallStatus = 'critical';
        } else if (dbHealth.status === 'degraded') {
          overallStatus = 'degraded';
        }
        
        res.json({
          status: overallStatus,
          timestamp: new Date().toISOString(),
          services: {
            database: {
              writeDB: dbHealth.writeDB,
              readDB: dbHealth.readDB,
              writeFailCount: dbHealth.writeDBFailCount,
              readFailCount: dbHealth.readDBFailCount,
              status: dbHealth.status
            },
            redis: {
              healthy: redisHealthy,
              status: redisHealthy ? 'healthy' : 'degraded'
            }
          }
        });
      } catch (error) {
        res.status(503).json({
          status: 'error',
          timestamp: new Date().toISOString(),
          error: '健康检查失败'
        });
      }
    });

    // 导入错误处理中间件
    const { notFoundHandler, errorHandler } = require('./middlewares/error-handler');

    // 404处理（放在所有路由之后）
    this.app.use(notFoundHandler);

    // 错误处理（放在最后）
    this.app.use(errorHandler);
  }

  /**
   * 启动服务器
   */
  start(): void {
    // 启动Sitemap定时生成任务
    const { scheduleSitemapGeneration } = require('./services/sitemap-generator');
    scheduleSitemapGeneration();
    
    this.app.listen(this.port, () => {
      console.log(`\n   [Web服务] 已启动: http://localhost:${this.port}`);
    });
  }

  /**
   * 获取Express实例
   */
  getApp(): express.Application {
    return this.app;
  }
}

