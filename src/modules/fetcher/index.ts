import { EventEmitter } from 'events';
import { BaseFetcher } from './base-fetcher';
import { laoyou28Config } from './sources/laoyou28';
import { duli28Config } from './sources/duli28';
import { gaga28Config } from './sources/gaga28';
import { openjiangConfig } from './sources/openjiang';
import { playnowKenoConfig } from './sources/playnow-keno';
import { LotteryData } from '../../types';
import { logger } from '../../libs/logger';

export class FetcherManager extends EventEmitter {
  private fetchers: BaseFetcher[] = [];

  constructor() {
    super();
    this.initializeFetchers();
  }

  /**
   * 初始化所有数据源抓取器
   * 
   * 环境变量控制：
   * - ENABLE_PLAYNOW=true: 启用PlayNow Keno官方源（加拿大服务器用）
   * - ENABLE_OTHER_SOURCES=false: 禁用其他数据源（加拿大服务器用）
   */
  private initializeFetchers(): void {
    const enablePlayNow = process.env.ENABLE_PLAYNOW === 'true';
    const enableOtherSources = process.env.ENABLE_OTHER_SOURCES !== 'false';
    
    const configs = [
      ...(enablePlayNow ? [playnowKenoConfig] : []),
      ...(enableOtherSources ? [
        laoyou28Config,
        duli28Config,
        gaga28Config,
        openjiangConfig
      ] : [])
    ];

    if (configs.length === 0) {
      logger.warn('没有启用任何数据源！请检查环境变量配置。');
      return;
    }

    logger.info({ 
      enablePlayNow, 
      enableOtherSources, 
      totalSources: configs.length 
    }, '数据源配置加载');

    for (const config of configs) {
      const fetcher = new BaseFetcher(config);
      
      // 监听数据事件
      fetcher.on('data', (data: LotteryData) => {
        this.emit('data', data);
      });

      this.fetchers.push(fetcher);
    }
  }

  /**
   * 启动所有抓取器
   */
  startAll(): void {
    for (const fetcher of this.fetchers) {
      fetcher.start();
    }
  }

  /**
   * 停止所有抓取器
   */
  stopAll(): void {
    logger.info('停止所有抓取器');
    for (const fetcher of this.fetchers) {
      fetcher.stop();
    }
  }

  /**
   * 获取所有抓取器状态
   */
  getStatus(): Array<{ name: string; running: boolean; interval: number }> {
    return this.fetchers.map(f => f.getStatus());
  }
}

