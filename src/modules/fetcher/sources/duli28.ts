import { DataSourceConfig, BaseLotteryData } from '../../../types';
import { parseStandardFormat } from '../../../helpers/parser';

/**
 * 独立28数据源配置
 * 
 * 数据源特点：
 * - 返回格式: {code: 1, data: [{qihao, opentime, opennum, sum}]}
 * - 需要跳过SSL验证
 * - 稳定性较好
 */

function parseDuli28(responseData: any): BaseLotteryData | null {
  return parseStandardFormat(responseData, 'duli28');
}

export const duli28Config: DataSourceConfig = {
  name: 'duli28',
  url: 'https://www.duli28.com/gengduo.php?page=1&type=1',
  interval: 1000,
  parser: parseDuli28,
  skipSSL: true
};

