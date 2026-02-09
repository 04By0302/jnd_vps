import { DataSourceConfig, BaseLotteryData } from '../../../types';

/**
 * PlayNow Keno官方数据源配置
 * 
 * 数据源特点：
 * - 加拿大官方BCLC Keno数据
 * - 每期开出20个号码
 * - 需要转换为PC28格式
 * - 检测间隔0.5秒
 * 
 * 转换规则：
 * - 第1个数: 位置2/5/8/11/14/17相加取个位
 * - 第2个数: 位置3/6/9/12/15/18相加取个位
 * - 第3个数: 位置4/7/10/13/16/19相加取个位
 * - 和值: 三个数相加
 * 
 * 接口格式：
 * - URL: https://www.playnow.com/services2/keno/draw/latest/1
 * - 响应: JSON数组格式
 * 
 * 注意事项：
 * - 数据源稳定可靠，为官方源
 * - 期号格式为7位数字
 * - 时间格式需要标准化
 */

interface KenoDrawData {
  drawNbr: number;
  drawDate: string;
  drawTime: string;
  drawNbrs: number[];
  drawBonus: number;
}

/**
 * Keno数据解析器
 * 将加拿大BCLC Keno数据转换为PC28格式
 */
function parseKenoData(data: any): BaseLotteryData | null {
  try {
    // 验证数据格式
    if (!data || !Array.isArray(data) || data.length === 0) {
      return null;
    }
    
    const kenoData: KenoDrawData = data[0];
    
    // 验证必需字段
    if (!kenoData.drawNbr || !kenoData.drawDate || !kenoData.drawTime || !kenoData.drawNbrs) {
      return null;
    }
    
    // 验证号码数量
    if (!Array.isArray(kenoData.drawNbrs) || kenoData.drawNbrs.length !== 20) {
      return null;
    }
    
    // 转换为PC28格式
    // 索引从0开始，所以位置要-1
    const nums = kenoData.drawNbrs;
    
    // 第1个数: 位置2,5,8,11,14,17 (索引1,4,7,10,13,16)
    const num1 = (nums[1] + nums[4] + nums[7] + nums[10] + nums[13] + nums[16]) % 10;
    
    // 第2个数: 位置3,6,9,12,15,18 (索引2,5,8,11,14,17)
    const num2 = (nums[2] + nums[5] + nums[8] + nums[11] + nums[14] + nums[17]) % 10;
    
    // 第3个数: 位置4,7,10,13,16,19 (索引3,6,9,12,15,18)
    const num3 = (nums[3] + nums[6] + nums[9] + nums[12] + nums[15] + nums[18]) % 10;
    
    // 和值
    const sum = num1 + num2 + num3;
    
    // 标准化时间格式
    const opentime = normalizeKenoTime(kenoData.drawDate, kenoData.drawTime);
    
    return {
      qihao: String(kenoData.drawNbr),
      opentime,
      opennum: `${num1}+${num2}+${num3}`,
      sum_value: sum,
      source: 'playnow-keno'
    };
    
  } catch (error) {
    return null;
  }
}

/**
 * 标准化Keno时间格式
 * 将 "Feb 8, 2026" "08:25:00 PM" 转换为 "2026-02-08 20:25:00"
 */
function normalizeKenoTime(dateStr: string, timeStr: string): string {
  try {
    // 解析日期: "Feb 8, 2026"
    const dateParts = dateStr.match(/(\w+)\s+(\d+),\s+(\d+)/);
    if (!dateParts) return `${dateStr} ${timeStr}`;
    
    const monthMap: { [key: string]: string } = {
      'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
      'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
      'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };
    
    const month = monthMap[dateParts[1]] || '01';
    const day = dateParts[2].padStart(2, '0');
    const year = dateParts[3];
    
    // 解析时间: "08:25:00 PM"
    const timeParts = timeStr.match(/(\d+):(\d+):(\d+)\s+(AM|PM)/);
    if (!timeParts) return `${year}-${month}-${day} ${timeStr}`;
    
    let hour = parseInt(timeParts[1]);
    const minute = timeParts[2];
    const second = timeParts[3];
    const period = timeParts[4];
    
    // 转换为24小时制
    if (period === 'PM' && hour !== 12) {
      hour += 12;
    } else if (period === 'AM' && hour === 12) {
      hour = 0;
    }
    
    const hourStr = hour.toString().padStart(2, '0');
    
    return `${year}-${month}-${day} ${hourStr}:${minute}:${second}`;
    
  } catch (error) {
    // 如果解析失败，返回原始格式
    return `${dateStr} ${timeStr}`;
  }
}

export const playnowKenoConfig: DataSourceConfig = {
  name: 'playnow-keno',
  url: 'https://www.playnow.com/services2/keno/draw/latest/1',
  interval: 500,  // 0.5秒检测间隔
  parser: parseKenoData,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.playnow.com/'
  }
};

