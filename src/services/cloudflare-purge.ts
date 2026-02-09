import { logger } from '../libs/logger';
import { config } from '../config';
import axios from 'axios';

/**
 * Cloudflare CDN缓存清理服务
 * 
 * 职责：
 * - 在新数据写入后清除Cloudflare边缘节点上的缓存
 * - 配合Redis缓存清理，确保用户获取最新数据
 * - 支持按URL精确清除和按标签批量清除
 * 
 * 使用场景：
 * - 新开奖数据写入后立即清除相关JSON API缓存
 * - 新预测数据生成后清除预测API缓存
 * 
 * 性能说明：
 * - Cloudflare API响应时间通常5-10秒
 * - 使用异步非阻塞调用，不影响主流程
 * - 清理失败不会抛出异常，仅记录警告日志
 * 
 * 配置要求：
 * - CF_ZONE_ID: Cloudflare Zone ID
 * - CF_API_TOKEN: Cloudflare API Token（需要Cache Purge权限）
 * - BASE_URL: 网站完整域名（例如：https://yourdomain.com）
 */

/**
 * 清除所有JSON数据API缓存
 * 
 * 包括：
 * - 开奖数据API: /kj.json
 * - 遗漏统计API: /yl.json
 * - 已开统计API: /yk.json
 * 
 * 调用时机：新开奖数据写入后
 */
export async function purgeDataJsonCache(): Promise<void> {
  if (!config.cloudflare.enabled) {
    logger.debug('Cloudflare未配置，跳过CDN缓存清除');
    return;
  }
  
  const urls = [
    `${config.cloudflare.baseUrl}/kj.json`,
    `${config.cloudflare.baseUrl}/yl.json`,
    `${config.cloudflare.baseUrl}/yk.json`
  ];
  
  await purgeCloudflareCache(urls, '数据API');
}

/**
 * 清除所有预测API缓存
 * 
 * 包括：
 * - 单双预测API: /ds.json
 * - 大小预测API: /dx.json
 * - 组合预测API: /zh.json
 * - 杀组合预测API: /sha.json
 * 
 * 调用时机：新预测生成完成后
 */
export async function purgePredictJsonCache(): Promise<void> {
  if (!config.cloudflare.enabled) {
    logger.debug('Cloudflare未配置，跳过CDN缓存清除');
    return;
  }
  
  const urls = [
    `${config.cloudflare.baseUrl}/ds.json`,
    `${config.cloudflare.baseUrl}/dx.json`,
    `${config.cloudflare.baseUrl}/zh.json`,
    `${config.cloudflare.baseUrl}/sha.json`
  ];
  
  await purgeCloudflareCache(urls, '预测API');
}

/**
 * 清除所有JSON API缓存（数据+预测）
 * 
 * 用于全面刷新所有API缓存
 * 
 * 调用时机：
 * - 系统重启后的初始化
 * - 手动触发全面刷新
 */
export async function purgeAllJsonCache(): Promise<void> {
  if (!config.cloudflare.enabled) {
    logger.debug('Cloudflare未配置，跳过CDN缓存清除');
    return;
  }
  
  const urls = [
    // 数据API
    `${config.cloudflare.baseUrl}/kj.json`,
    `${config.cloudflare.baseUrl}/yl.json`,
    `${config.cloudflare.baseUrl}/yk.json`,
    // 预测API
    `${config.cloudflare.baseUrl}/ds.json`,
    `${config.cloudflare.baseUrl}/dx.json`,
    `${config.cloudflare.baseUrl}/zh.json`,
    `${config.cloudflare.baseUrl}/sha.json`
  ];
  
  await purgeCloudflareCache(urls, '全部API');
}

/**
 * 通用Cloudflare缓存清除函数
 * 
 * 使用Cloudflare API的文件清除模式（精确匹配URL）
 * 
 * API限制：
 * - 单次最多清除30个URL
 * - 免费版每24小时最多1000次清除操作
 * - 响应时间通常5-10秒
 * 
 * 错误处理：
 * - 网络错误：记录警告，不抛出异常
 * - API错误：记录错误详情，不抛出异常
 * - 未配置：静默跳过
 * 
 * @param urls 要清除的URL列表（完整URL，包含协议和域名）
 * @param description 描述信息，用于日志记录
 */
async function purgeCloudflareCache(urls: string[], description: string): Promise<void> {
  try {
    const startTime = Date.now();
    
    const response = await axios.post(
      `https://api.cloudflare.com/client/v4/zones/${config.cloudflare.zoneId}/purge_cache`,
      { files: urls },
      {
        headers: {
          'Authorization': `Bearer ${config.cloudflare.apiToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000 // 15秒超时
      }
    );
    
    const data = response.data as { success: boolean; errors?: any[] };
    const duration = Date.now() - startTime;
    
    if (data.success) {
      logger.info({ 
        description, 
        count: urls.length, 
        duration 
      }, 'Cloudflare缓存清除成功');
    } else {
      logger.warn({ 
        description,
        errors: data.errors,
        duration
      }, 'Cloudflare缓存清除失败');
    }
  } catch (error: any) {
    // 网络错误或超时，不应影响主流程
    logger.warn({ 
      description,
      error: error?.message || String(error),
      code: error?.code
    }, 'Cloudflare缓存清除异常（非致命）');
  }
}

