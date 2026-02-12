import { writeDB, readDB } from '../database/client';
import { logger } from '../libs/logger';
import { withRetry, batchUpdateStats } from '../database/operations';
import { YiLouData, LotteryData } from '../types';
import { collectHitTypes } from '../helpers/lottery-analyzer';
import { getAllStatTypes, createEmptyStatObject } from '../config/stat-types';

/**
 * 遗漏数据服务
 * 
 * 负责管理 omission_data 表的数据更新和读取
 * 表结构：每种类型一条记录，共49条（21种基础类型 + 28种和值）
 * 更新方式：每次开奖后直接UPDATE现有记录
 */

/**
 * 更新遗漏数据表
 * 
 * 使用预计算属性，无需重复判断
 * 
 * 根据最新开奖数据，更新所有类型的遗漏值
 * - 本期开出的类型：遗漏值=0
 * - 未开出的类型：遗漏值+1
 * 
 * @param data 开奖数据（包含预计算属性）
 */
export async function updateOmissionData(data: LotteryData): Promise<void> {
  try {
    // 1. 检查表是否为空，如果为空则自动初始化
    const count = await readDB.omission_data.count();
    if (count === 0) {
      logger.info('omission_data表为空，自动执行初始化...');
      await initializeOmissionData();
    }
    
    // 2. 直接从预计算字段获取命中类型（使用统一函数）
    const hitTypes = new Set(collectHitTypes(data));
    
    // 3. 获取当前所有遗漏记录
    const currentOmissions = await readDB.omission_data.findMany();
    
    // 4. 计算新的遗漏值
    const updates = currentOmissions.map((record: any) => ({
      type: record.omission_type,
      count: hitTypes.has(record.omission_type) ? 0 : record.omission_count + 1
    }));
    
    // 5. 批量更新数据库（使用统一的批量操作函数）
    await batchUpdateStats('omission_data', updates);
    
    logger.debug({ qihao: data.qihao, hitCount: hitTypes.size }, '遗漏数据更新成功');
    
  } catch (error) {
    logger.error({ error, qihao: data.qihao }, '更新遗漏数据失败');
    throw error;
  }
}



/**
 * 从数据库读取遗漏数据
 * 
 * 用于生成 yl.json 文件
 * 
 * @returns 遗漏数据对象，表为空时返回null
 */
export async function readOmissionFromDB(): Promise<YiLouData | null> {
  try {
    const records = await readDB.omission_data.findMany();
    
    if (records.length === 0) {
      logger.warn('omission_data表为空');
      return null;
    }
    
    // 转换为YiLouData格式
    const yilou: any = {};
    records.forEach((record: any) => {
      yilou[record.omission_type] = record.omission_count;
    });
    
    return yilou as YiLouData;
    
  } catch (error) {
    logger.error({ error }, '读取遗漏数据失败');
    return null;
  }
}

/**
 * 动态计算遗漏数据
 * 从最新期开始分批查询，直到所有类型都出现过至少一次
 */
export async function calculateYilouDynamic(): Promise<YiLouData> {
  const BATCH_SIZE = 500;
  const MAX_RECORDS = 10000;
  let offset = 0;
  
  // 使用统一函数创建空统计对象
  const yilou: any = createEmptyStatObject();
  // 初始化为-1表示未找到
  for (const key in yilou) {
    yilou[key] = -1;
  }
  
  // 使用统一的类型列表
  const allTypes = getAllStatTypes();
  const foundTypes = new Set<string>();
  
  while (offset < MAX_RECORDS && foundTypes.size < allTypes.length) {
    // 分批查询（使用预计算字段）
    const batch = await withRetry(
      async () => await readDB.latest_lottery_data.findMany({
        orderBy: { opentime: 'desc' },
        skip: offset,
        take: BATCH_SIZE,
        select: {
          sum_value: true,
          is_da: true,
          is_xiao: true,
          is_dan: true,
          is_shuang: true,
          is_jida: true,
          is_jixiao: true,
          is_baozi: true,
          is_duizi: true,
          is_shunzi: true,
          is_zaliu: true,
          is_xiaobian: true,
          is_zhong: true,
          is_dabian: true,
          is_bian: true,
          is_long: true,
          is_hu: true,
          is_he: true
        }
      }),
      { operation: `查询遗漏数据批次(offset=${offset})` }
    );
    
    if (batch.length === 0) break;
    
    // 遍历每期数据，使用预计算字段
    for (let i = 0; i < batch.length; i++) {
      const record: any = batch[i];
      const currentIndex = offset + i;
      
      // 和值（00-27）
      const sumKey = String(record.sum_value).padStart(2, '0');
      if (yilou[sumKey] === -1) {
        yilou[sumKey] = currentIndex;
        foundTypes.add(sumKey);
      }
      
      // 大小
      if (yilou.da === -1 && record.is_da) {
        yilou.da = currentIndex;
        foundTypes.add('da');
      }
      if (yilou.xiao === -1 && record.is_xiao) {
        yilou.xiao = currentIndex;
        foundTypes.add('xiao');
      }
      
      // 单双
      if (yilou.dan === -1 && record.is_dan) {
        yilou.dan = currentIndex;
        foundTypes.add('dan');
      }
      if (yilou.shuang === -1 && record.is_shuang) {
        yilou.shuang = currentIndex;
        foundTypes.add('shuang');
      }
      
      // 组合
      if (yilou.dd === -1 && record.is_da && record.is_dan) {
        yilou.dd = currentIndex;
        foundTypes.add('dd');
      }
      if (yilou.xd === -1 && record.is_xiao && record.is_dan) {
        yilou.xd = currentIndex;
        foundTypes.add('xd');
      }
      if (yilou.ds === -1 && record.is_da && record.is_shuang) {
        yilou.ds = currentIndex;
        foundTypes.add('ds');
      }
      if (yilou.xs === -1 && record.is_xiao && record.is_shuang) {
        yilou.xs = currentIndex;
        foundTypes.add('xs');
      }
      
      // 极值
      if (yilou.jd === -1 && record.is_jida) {
        yilou.jd = currentIndex;
        foundTypes.add('jd');
      }
      if (yilou.jx === -1 && record.is_jixiao) {
        yilou.jx = currentIndex;
        foundTypes.add('jx');
      }
      
      // 形态
      if (yilou.bz === -1 && record.is_baozi) {
        yilou.bz = currentIndex;
        foundTypes.add('bz');
      }
      if (yilou.dz === -1 && record.is_duizi) {
        yilou.dz = currentIndex;
        foundTypes.add('dz');
      }
      if (yilou.sz === -1 && record.is_shunzi) {
        yilou.sz = currentIndex;
        foundTypes.add('sz');
      }
      if (yilou.zl === -1 && record.is_zaliu) {
        yilou.zl = currentIndex;
        foundTypes.add('zl');
      }
      
      // 边
      if (yilou.xb === -1 && record.is_xiaobian) {
        yilou.xb = currentIndex;
        foundTypes.add('xb');
      }
      if (yilou.zhong === -1 && record.is_zhong) {
        yilou.zhong = currentIndex;
        foundTypes.add('zhong');
      }
      if (yilou.db === -1 && record.is_dabian) {
        yilou.db = currentIndex;
        foundTypes.add('db');
      }
      if (yilou.bian === -1 && record.is_bian) {
        yilou.bian = currentIndex;
        foundTypes.add('bian');
      }
      
      // 龙虎合
      if (yilou.long === -1 && record.is_long) {
        yilou.long = currentIndex;
        foundTypes.add('long');
      }
      if (yilou.hu === -1 && record.is_hu) {
        yilou.hu = currentIndex;
        foundTypes.add('hu');
      }
      if (yilou.he === -1 && record.is_he) {
        yilou.he = currentIndex;
        foundTypes.add('he');
      }
    }
    
    offset += batch.length;
    
    // 检查是否所有类型都已找到
    if (foundTypes.size === allTypes.length) {
      logger.info({ 
        recordsScanned: offset, 
        typesFound: foundTypes.size 
      }, '遗漏计算完成（所有类型已找到）');
      break;
    }
  }
  
  // 将未找到的类型（-1）设置为已扫描的期数
  for (const type of allTypes) {
    if (yilou[type] === -1) {
      yilou[type] = offset;
    }
  }
  
  if (offset >= MAX_RECORDS) {
    logger.warn({ 
      recordsScanned: offset,
      typesFound: foundTypes.size,
      totalTypes: allTypes.length
    }, '达到最大查询上限');
  }
  
  return yilou as YiLouData;
}

/**
 * 初始化遗漏数据表
 * 
 * 首次部署时执行，为所有类型创建初始记录
 * 使用动态计算获取当前真实遗漏值
 * 使用upsert避免唯一约束冲突
 */
export async function initializeOmissionData(): Promise<void> {
  try {
    logger.info('开始初始化omission_data表...');
    
    // 1. 使用统一的类型列表
    const allTypes = getAllStatTypes();
    
    // 2. 动态计算当前遗漏值
    const yilou = await calculateYilouDynamic();
    
    // 3. 使用upsert逐条插入，避免唯一约束冲突
    let successCount = 0;
    for (const type of allTypes) {
      try {
        await writeDB.omission_data.upsert({
          where: { omission_type: type },
          create: {
            omission_type: type,
            omission_count: yilou[type] || 0
          },
          update: {
            omission_count: yilou[type] || 0
          }
        });
        successCount++;
      } catch (error) {
        logger.warn({ type, error }, '插入遗漏数据失败');
      }
    }
    
    logger.info({ total: allTypes.length, success: successCount }, '遗漏数据初始化完成');
    
  } catch (error) {
    logger.error({ error }, '初始化遗漏数据失败');
    throw error;
  }
}

