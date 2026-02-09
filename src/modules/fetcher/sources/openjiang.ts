import { DataSourceConfig } from '../../../types';
import { parseUniversalFormat } from '../../../helpers/parser';

/**
 * OpenJiang数据源配置
 * 
 * 数据源特点：
 * - 提供标准的JSON API接口
 * - 需要token认证
 * - 高频检测：2秒/次，快速获取最新数据
 * - 返回最新一期开奖数据
 * 
 * 接口格式：
 * - URL参数：token（认证令牌）、t（彩种类型）、rows（返回条数）、p（返回格式）
 * - 响应格式：JSON，包含期号、开奖号码、开奖时间等字段
 */
export const openjiangConfig: DataSourceConfig = {
  name: 'openjiang',
  url: 'http://api.openjiang.com/api?token=B0273B96C1D0D842&t=jnd28&rows=1&p=json',
  interval: 2000,  // 2秒/次（2000毫秒）
  parser: (data: any) => parseUniversalFormat(data, 'openjiang')
};

