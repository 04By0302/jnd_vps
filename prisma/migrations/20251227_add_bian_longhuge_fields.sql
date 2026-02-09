-- 添加边和龙虎合字段到 latest_lottery_data 表
-- 迁移时间: 2025-12-27
-- 说明: 添加小边/中/大边/边以及龙虎合统计字段

-- 添加边相关字段
ALTER TABLE `latest_lottery_data`
  ADD COLUMN `is_xiaobian` TINYINT NOT NULL DEFAULT 0 COMMENT '小边（和值 0-9）',
  ADD COLUMN `is_zhong` TINYINT NOT NULL DEFAULT 0 COMMENT '中（和值 10-17）',
  ADD COLUMN `is_dabian` TINYINT NOT NULL DEFAULT 0 COMMENT '大边（和值 18-27）',
  ADD COLUMN `is_bian` TINYINT NOT NULL DEFAULT 0 COMMENT '边（小边或大边）';

-- 添加龙虎合字段
ALTER TABLE `latest_lottery_data`
  ADD COLUMN `is_long` TINYINT NOT NULL DEFAULT 0 COMMENT '龙（num1 > num3）',
  ADD COLUMN `is_hu` TINYINT NOT NULL DEFAULT 0 COMMENT '虎（num1 < num3）',
  ADD COLUMN `is_he` TINYINT NOT NULL DEFAULT 0 COMMENT '合（num1 = num3）';

-- 为已有数据补充计算这些字段的值
-- 更新边字段
UPDATE `latest_lottery_data` SET 
  `is_xiaobian` = CASE WHEN `sum_value` >= 0 AND `sum_value` <= 9 THEN 1 ELSE 0 END,
  `is_zhong` = CASE WHEN `sum_value` >= 10 AND `sum_value` <= 17 THEN 1 ELSE 0 END,
  `is_dabian` = CASE WHEN `sum_value` >= 18 AND `sum_value` <= 27 THEN 1 ELSE 0 END;

UPDATE `latest_lottery_data` SET 
  `is_bian` = CASE WHEN (`sum_value` >= 0 AND `sum_value` <= 9) OR (`sum_value` >= 18 AND `sum_value` <= 27) THEN 1 ELSE 0 END;

-- 更新龙虎合字段（需要从opennum解析出num1和num3）
-- 注意：这个更新语句假设 opennum 格式为 "num1+num2+num3"
UPDATE `latest_lottery_data` SET
  `is_long` = CASE WHEN 
    CAST(SUBSTRING_INDEX(opennum, '+', 1) AS UNSIGNED) > 
    CAST(SUBSTRING_INDEX(opennum, '+', -1) AS UNSIGNED) 
    THEN 1 ELSE 0 END,
  `is_hu` = CASE WHEN 
    CAST(SUBSTRING_INDEX(opennum, '+', 1) AS UNSIGNED) < 
    CAST(SUBSTRING_INDEX(opennum, '+', -1) AS UNSIGNED) 
    THEN 1 ELSE 0 END,
  `is_he` = CASE WHEN 
    CAST(SUBSTRING_INDEX(opennum, '+', 1) AS UNSIGNED) = 
    CAST(SUBSTRING_INDEX(opennum, '+', -1) AS UNSIGNED) 
    THEN 1 ELSE 0 END;












