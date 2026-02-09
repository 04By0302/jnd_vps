import fs from 'fs/promises';
import path from 'path';
import { logger } from '../libs/logger';
import { LotteryData } from '../types';

const BACKUP_FILE = path.resolve('./data/lottery_backup.json');
const MAX_BACKUP_RECORDS = 1000;

/**
 * 备份开奖数据到本地JSON
 * 实现双写机制，每次写入MySQL成功后同时备份到本地
 */
export async function backupToLocalJson(data: LotteryData): Promise<void> {
  try {
    // 确保目录存在
    await fs.mkdir(path.dirname(BACKUP_FILE), { recursive: true });
    
    // 读取现有数据
    let records: any[] = [];
    try {
      const content = await fs.readFile(BACKUP_FILE, 'utf-8');
      records = JSON.parse(content);
    } catch {
      // 文件不存在或解析失败，使用空数组
    }
    
    // 添加新数据（去重）
    const exists = records.find((r: any) => r.qihao === data.qihao);
    if (!exists) {
      records.unshift({
        qihao: data.qihao,
        opentime: data.opentime,
        opennum: data.opennum,
        sum_value: data.sum_value,
        source: data.source
      });
      
      // 保留最近1000期
      if (records.length > MAX_BACKUP_RECORDS) {
        records = records.slice(0, MAX_BACKUP_RECORDS);
      }
      
      // 写入文件
      await fs.writeFile(BACKUP_FILE, JSON.stringify(records, null, 2), 'utf-8');
      logger.debug(`本地备份已更新 期号:${data.qihao} 总计:${records.length}期`);
    }
  } catch (error) {
    logger.warn({ error, qihao: data.qihao }, '备份到本地JSON失败');
  }
}

/**
 * 从本地JSON读取数据（降级方案）
 * 当数据库连接失败时自动使用
 */
export async function readFromLocalJson(limit: number = 1): Promise<any[]> {
  try {
    const content = await fs.readFile(BACKUP_FILE, 'utf-8');
    const records = JSON.parse(content);
    return records.slice(0, limit);
  } catch (error) {
    logger.warn({ error, limit }, '从本地JSON读取失败');
    return [];
  }
}




