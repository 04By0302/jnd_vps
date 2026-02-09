/**
 * 动态Sitemap生成服务
 * 自动生成和更新sitemap.xml文件
 */

import { writeFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '../libs/logger';

/**
 * Sitemap URL配置
 */
interface SitemapUrl {
  loc: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
}

/**
 * 获取当前日期（YYYY-MM-DD格式）
 */
function getCurrentDate(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * 获取所有需要索引的URL配置
 */
function getSitemapUrls(): SitemapUrl[] {
  const baseUrl = 'https://pc28.help';

  return [
    // 主要页面
    {
      loc: `${baseUrl}/`,
      changefreq: 'daily',
      priority: 1.0
    },
    {
      loc: `${baseUrl}/api.html`,
      changefreq: 'weekly',
      priority: 0.9
    },
    {
      loc: `${baseUrl}/history.html`,
      changefreq: 'weekly',
      priority: 0.8
    },

    // 实时数据API（高优先级）
    {
      loc: `${baseUrl}/kj.json`,
      changefreq: 'always',
      priority: 0.9
    },
    {
      loc: `${baseUrl}/yl.json`,
      changefreq: 'always',
      priority: 0.9
    },
    {
      loc: `${baseUrl}/yk.json`,
      changefreq: 'always',
      priority: 0.9
    },

    // AI预测接口
    {
      loc: `${baseUrl}/ds.json`,
      changefreq: 'always',
      priority: 0.85
    },
    {
      loc: `${baseUrl}/dx.json`,
      changefreq: 'always',
      priority: 0.85
    },
    {
      loc: `${baseUrl}/zh.json`,
      changefreq: 'always',
      priority: 0.85
    },
    {
      loc: `${baseUrl}/sha.json`,
      changefreq: 'always',
      priority: 0.85
    },

    // 胜率统计API
    {
      loc: `${baseUrl}/api/winrate/danshuang`,
      changefreq: 'always',
      priority: 0.7
    },
    {
      loc: `${baseUrl}/api/winrate/daxiao`,
      changefreq: 'always',
      priority: 0.7
    },
    {
      loc: `${baseUrl}/api/winrate/combination`,
      changefreq: 'always',
      priority: 0.7
    },
    {
      loc: `${baseUrl}/api/winrate/kill`,
      changefreq: 'always',
      priority: 0.7
    },

    // 数据导出接口
    {
      loc: `${baseUrl}/api/export/lottery`,
      changefreq: 'always',
      priority: 0.6
    },
    {
      loc: `${baseUrl}/api/export/stats`,
      changefreq: 'always',
      priority: 0.6
    },

    // 系统监控
    {
      loc: `${baseUrl}/health`,
      changefreq: 'daily',
      priority: 0.3
    },

    // Google验证文件
    {
      loc: `${baseUrl}/google862b8bff9fe145e4.html`,
      changefreq: 'never',
      priority: 0.1
    }
  ];
}

/**
 * 生成Sitemap XML内容
 */
function generateSitemapXml(urls: SitemapUrl[]): string {
  const currentDate = getCurrentDate();
  
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
  xml += '        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
  xml += '        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9\n';
  xml += '        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">\n';
  xml += '    \n';

  for (const url of urls) {
    xml += '    <url>\n';
    xml += `        <loc>${url.loc}</loc>\n`;
    xml += `        <lastmod>${currentDate}</lastmod>\n`;
    xml += `        <changefreq>${url.changefreq}</changefreq>\n`;
    xml += `        <priority>${url.priority.toFixed(1)}</priority>\n`;
    xml += '    </url>\n';
    xml += '    \n';
  }

  xml += '</urlset>\n';

  return xml;
}

/**
 * 生成并保存Sitemap文件
 */
export async function generateSitemap(): Promise<void> {
  try {
    logger.info('[Sitemap] 开始生成sitemap.xml...');

    // 获取所有URL配置
    const urls = getSitemapUrls();

    // 生成XML内容
    const xmlContent = generateSitemapXml(urls);

    // 写入文件
    const publicDir = join(process.cwd(), 'public');
    const sitemapPath = join(publicDir, 'sitemap.xml');

    await writeFile(sitemapPath, xmlContent, 'utf-8');

    logger.info(
      { 
        path: sitemapPath, 
        urlCount: urls.length 
      },
      '[Sitemap] sitemap.xml生成成功'
    );
  } catch (error: any) {
    logger.error(
      { 
        error: error.message, 
        stack: error.stack 
      },
      '[Sitemap] sitemap.xml生成失败'
    );
    throw error;
  }
}

/**
 * 定时更新Sitemap（每天凌晨3点）
 */
export function scheduleSitemapGeneration(): void {
  const INTERVAL = 24 * 60 * 60 * 1000; // 24小时

  // 立即生成一次
  generateSitemap().catch(err => {
    logger.error({ error: err.message }, '[Sitemap] 初始生成失败');
  });

  // 定时更新
  setInterval(() => {
    generateSitemap().catch(err => {
      logger.error({ error: err.message }, '[Sitemap] 定时生成失败');
    });
  }, INTERVAL);

  logger.info('[Sitemap] 定时生成任务已启动（每24小时更新一次）');
}

