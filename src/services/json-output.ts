import fs from 'fs/promises';
import path from 'path';
import { readDB } from '../database/client';
import { config } from '../config';
import { logger } from '../libs/logger';
import { KjJsonOutput } from '../types';
import { withFallback } from '../database/operations';
import { readFromLocalJson } from './json-fallback';
import { formatDateTime } from '../helpers/datetime';
import { calculateYilouDynamic, readOmissionFromDB } from './omission-data';

/**
 * 生成kj.json（最新N期数据）
 * 
 * 功能说明：
 * - 生成静态JSON文件，仅作为数据库故障时的降级备用方案
 * - API接口（/kj.json）不直接读取此文件，而是查询数据库+Redis缓存
 * - 缓存清除由统一的cache-manager模块负责，不在此处理
 * 
 * @param limit 查询期数，默认1
 */
export async function generateKjJson(limit: number = 1): Promise<void> {
  try {
    const records = await withFallback(
      // 主方案：查询数据库
      async () => await readDB.latest_lottery_data.findMany({
        orderBy: {
          opentime: 'desc'
        },
        take: limit
      }),
      // 降级方案：读取本地JSON
      async () => await readFromLocalJson(limit),
      { operation: '查询最新开奖数据' }
    );

    const output: KjJsonOutput = {
      data: records.map((record: any) => ({
        qihao: record.qihao,
        opentime: formatDateTime(new Date(record.opentime), true),
        opennum: record.opennum,
        sum: String(record.sum_value)
      })),
      message: 'success'
    };

    const filePath = config.getOutputPath(config.output.kjFile);
    await fs.writeFile(filePath, JSON.stringify(output, null, 2), 'utf-8');
    
    // 注意：缓存清除已移至统一的cache-manager模块
  } catch (error) {
    logger.error({ error }, '生成kj.json失败');
    throw error;
  }
}



/**
 * 通用的统计数据JSON字段构建器
 * 
 * 统一供 generateYlJson() 和 generateYkJson() 使用
 */
function buildStatsJsonFields(data: any): string[] {
  const fields: string[] = [];
  
  // 基础统计类型（固定顺序）
  const baseTypes = ['da', 'xiao', 'dan', 'shuang', 'dd', 'xd', 'ds', 'xs', 'jd', 'jx', 'dz', 'sz', 'bz', 'zl', 'xb', 'zhong', 'db', 'bian', 'long', 'hu', 'he'];
  baseTypes.forEach(type => {
    fields.push(`"${type}":${data[type]}`);
  });
  
  // 和值统计（00-27）
  for (let i = 0; i <= 27; i++) {
    const key = String(i).padStart(2, '0');
    fields.push(`"${key}":${data[key]}`);
  }
  
  return fields;
}

/**
 * 生成yl.json（遗漏数据）
 * 
 * 功能说明：
 * - 生成遗漏统计静态JSON文件，作为降级备用方案
 * - 优先从数据库omission_data表读取，失败则降级到动态计算
 * - API接口不直接读取此文件，而是通过sendFile+ETag缓存机制提供
 * 
 * 数据来源优先级：
 * 1. 数据库omission_data表（最快）
 * 2. 动态计算（兜底方案）
 */
export async function generateYlJson(): Promise<void> {
  try {
    // 优先从数据库读取
    let omissionData = await readOmissionFromDB();
    
    // 如果数据库无数据，回退到动态计算
    if (!omissionData) {
      logger.warn('遗漏数据表为空，使用动态计算');
      omissionData = await calculateYilouDynamic();
    }

    // 使用统一的字段构建器
    const jsonFields = buildStatsJsonFields(omissionData);
    const jsonStr = `{"data":{${jsonFields.join(',')}},"message":"success"}`;

    const filePath = config.getOutputPath(config.output.ylFile);
    await fs.writeFile(filePath, jsonStr, 'utf-8');
  } catch (error) {
    logger.error({ error }, '生成yl.json失败');
    throw error;
  }
}

/**
 * 生成yk.json（已开数据统计 - 今日数据）
 * 
 * 功能说明：
 * - 生成今日已开统计静态JSON文件，作为降级备用方案
 * - 数据来源于daily_statistics表的今日统计
 * - API接口不直接读取此文件，而是通过sendFile+ETag缓存机制提供
 */
export async function generateYkJson(): Promise<void> {
  try {
    const { getTodayStatistics } = await import('./daily-stats');
    const todayStats = await getTodayStatistics();

    // 使用统一的字段构建器
    const jsonFields = buildStatsJsonFields(todayStats);
    const jsonStr = `{"data":{${jsonFields.join(',')}},"message":"success"}`;

    const filePath = config.getOutputPath(config.output.ykFile);
    await fs.writeFile(filePath, jsonStr, 'utf-8');
  } catch (error) {
    logger.error({ error }, '生成yk.json失败');
    throw error;
  }
}

/**
 * 生成所有JSON文件
 * 串行执行，避免连接池竞争，单个失败不影响其他
 */
export async function generateAllJson(): Promise<void> {
  // 串行执行，避免连接池压力
  const results = await Promise.allSettled([
    generateKjJson(1),
    generateYlJson(),
    generateYkJson()
  ]);
  
  // 检查失败的任务
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const names = ['kj.json', 'yl.json', 'yk.json'];
      logger.error({ 
        file: names[index], 
        error: result.reason 
      }, 'JSON文件生成失败');
    }
  });
  
  // 不输出JSON更新日志，减少噪音
}

/**
 * 确保输出目录存在
 */
export async function ensureOutputDirectory(): Promise<void> {
  try {
    const outputDir = path.resolve(config.output.dir);
    await fs.mkdir(outputDir, { recursive: true });
  } catch (error) {
    logger.error({ error }, '创建输出目录失败');
    throw error;
  }
}

