import { DataSourceConfig, BaseLotteryData } from '../../../types';
import { parseStandardFormat } from '../../../helpers/parser';

/**
 * 老友28数据源配置
 * 
 * 数据源特点：
 * - 返回格式: {code: 1, data: [{qihao, opentime, opennum, sum}]}
 * - 需要跳过SSL验证
 * - 稳定性较好
 */

function parseLaoyou28(responseData: any): BaseLotteryData | null {
  return parseStandardFormat(responseData, 'laoyou28');
}

export const laoyou28Config: DataSourceConfig = {
  name: 'laoyou28',
  url: 'https://www.laoyou28.com/gengduo.php?page=1&type=1',
  interval: 1000,
  parser: parseLaoyou28,
  skipSSL: true
};

