import ExcelJS from 'exceljs';
import { readDB } from '../database/client';
import { logger } from '../libs/logger';
import { getBeijingDateString, formatDateString, formatDateTime } from '../helpers/datetime';

/**
 * Excel导出服务
 * 负责生成历史数据的Excel文件
 */

/**
 * 导出开奖数据为Excel
 * @param limit 期数限制
 */
export async function exportLotteryDataToExcel(limit: number): Promise<ExcelJS.Buffer> {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('开奖数据');

    // 设置列
    worksheet.columns = [
      { header: '期号', key: 'qihao', width: 15 },
      { header: '开奖时间', key: 'opentime', width: 20 },
      { header: '开奖号码', key: 'opennum', width: 15 },
      { header: '和值', key: 'sum_value', width: 10 }
    ];

    // 样式设置
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // 查询数据
    const records = await readDB.latest_lottery_data.findMany({
      orderBy: { opentime: 'desc' },
      take: limit,
      select: {
        qihao: true,
        opentime: true,
        opennum: true,
        sum_value: true
      }
    });

    // 添加数据行
    records.forEach((record: any) => {
      worksheet.addRow({
        qihao: record.qihao,
        opentime: formatDateTime(record.opentime, true),
        opennum: record.opennum,
        sum_value: record.sum_value
      });
    });

    // 添加边框
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    // 生成Buffer
    const buffer = await workbook.xlsx.writeBuffer();
    logger.info({ limit, count: records.length }, '开奖数据Excel生成成功');
    return buffer as ExcelJS.Buffer;

  } catch (error) {
    logger.error({ error, limit }, '开奖数据Excel生成失败');
    throw error;
  }
}

/**
 * 导出已开统计数据为Excel
 * @param days 天数
 */
export async function exportStatsDataToExcel(days: number): Promise<ExcelJS.Buffer> {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('已开统计');

    // 设置列
    worksheet.columns = [
      { header: '日期', key: 'date', width: 15 },
      { header: '统计类型', key: 'type', width: 15 },
      { header: '出现次数', key: 'count', width: 12 }
    ];

    // 样式设置
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // 计算日期范围（使用北京时间）
    const endDateStr = getBeijingDateString();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days + 1);
    const startDateStr = formatDateString(startDate);

    // 查询数据
    const records = await readDB.$queryRaw<Array<{
      qihao: string;
      omission_type: string;
      omission_count: number;
    }>>`
      SELECT qihao, omission_type, omission_count
      FROM today_stats_data
      WHERE qihao >= ${startDateStr} AND qihao <= ${endDateStr}
      ORDER BY qihao DESC, omission_type
    `;

    // 添加数据行
    records.forEach((record: any) => {
      worksheet.addRow({
        date: record.qihao,
        type: getTypeLabel(record.omission_type),
        count: record.omission_count
      });
    });

    // 添加边框
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    // 生成Buffer
    const buffer = await workbook.xlsx.writeBuffer();
    logger.info({ days, count: records.length }, '统计数据Excel生成成功');
    return buffer as ExcelJS.Buffer;

  } catch (error) {
    logger.error({ error, days }, '统计数据Excel生成失败');
    throw error;
  }
}

/**
 * 获取统计类型的中文标签
 */
function getTypeLabel(type: string): string {
  const labels: { [key: string]: string } = {
    'da': '大',
    'xiao': '小',
    'dan': '单',
    'shuang': '双',
    'dd': '大单',
    'xd': '小单',
    'ds': '大双',
    'xs': '小双',
    'jd': '极大',
    'jx': '极小',
    'dz': '对子',
    'sz': '顺子',
    'bz': '豹子',
    'zl': '杂六',
    'xb': '小边',
    'zhong': '中',
    'db': '大边',
    'bian': '边',
    'long': '龙',
    'hu': '虎',
    'he': '合'
  };

  // 如果是和值（00-27），直接返回
  if (/^\d{2}$/.test(type)) {
    return `和值${type}`;
  }

  return labels[type] || type;
}

