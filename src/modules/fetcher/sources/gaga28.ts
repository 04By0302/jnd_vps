import { DataSourceConfig, BaseLotteryData } from '../../../types';
import { parseStandardFormat } from '../../../helpers/parser';

/**
 * 嘎嘎28数据源配置
 * 
 * 数据源特点：
 * - 返回格式: {code: 1, data: [{qihao, opentime, opennum, sum}]}
 * - 需要跳过SSL验证
 * - 稳定性较好
 */

function parseGaga28(responseData: any): BaseLotteryData | null {
  return parseStandardFormat(responseData, 'gaga28');
}

export const gaga28Config: DataSourceConfig = {
  name: 'gaga28',
  url: 'https://www.gaga28.com/gengduo.php?page=1&type=1',
  interval: 1000,
  parser: parseGaga28,
  skipSSL: true
};

