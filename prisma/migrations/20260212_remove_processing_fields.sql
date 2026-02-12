-- 删除不必要的处理状态字段
-- 改用Redis存储，避免频繁UPDATE主表造成锁表

-- 删除索引
DROP INDEX IF EXISTS `idx_omission_processed` ON `latest_lottery_data`;
DROP INDEX IF EXISTS `idx_stats_processed` ON `latest_lottery_data`;
DROP INDEX IF EXISTS `idx_prediction_processed` ON `latest_lottery_data`;

-- 删除字段
ALTER TABLE `latest_lottery_data` DROP COLUMN IF EXISTS `omission_processed`;
ALTER TABLE `latest_lottery_data` DROP COLUMN IF EXISTS `stats_processed`;
ALTER TABLE `latest_lottery_data` DROP COLUMN IF EXISTS `prediction_processed`;


