-- 添加 omission_processed 字段到 latest_lottery_data 表
-- 用于标记该期数据是否已处理遗漏数据更新

ALTER TABLE `latest_lottery_data` 
ADD COLUMN `omission_processed` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '遗漏数据是否已处理' AFTER `is_he`;

-- 添加索引以提高查询效率
CREATE INDEX `idx_omission_processed` ON `latest_lottery_data` (`omission_processed`, `opentime` DESC);

