-- 优化 ai_predictions 表索引
-- 目标：提升查询性能，优化胜率计算

-- 1. 删除冗余索引
DROP INDEX IF EXISTS idx_created_at ON ai_predictions;
DROP INDEX IF EXISTS idx_predict_hit_created ON ai_predictions;
DROP INDEX IF EXISTS idx_predict_type ON ai_predictions;
DROP INDEX IF EXISTS idx_qihao ON ai_predictions;

-- 2. 修改 predict_value 字段长度，支持双组合格式
ALTER TABLE ai_predictions 
MODIFY COLUMN predict_value VARCHAR(50) NOT NULL;

-- 3. 创建优化的索引
-- 索引1：查询某类型最近N期预测（用于预测JSON生成）
CREATE INDEX idx_type_qihao ON ai_predictions(predict_type, qihao DESC);

-- 索引2：查询某类型已开奖的近N期（用于胜率计算）
-- 这是核心优化：WHERE predict_type = ? AND hit IS NOT NULL ORDER BY qihao DESC LIMIT 100
CREATE INDEX idx_type_hit_qihao ON ai_predictions(predict_type, hit, qihao DESC);

-- 索引说明：
-- idx_type_qihao: 
--   - 用于查询最近20期预测数据（生成JSON）
--   - 查询模式: SELECT * FROM ai_predictions WHERE predict_type = ? ORDER BY qihao DESC LIMIT 20
--
-- idx_type_hit_qihao:
--   - 用于查询已开奖的近100期（胜率计算）
--   - 查询模式: SELECT * FROM ai_predictions WHERE predict_type = ? AND hit IS NOT NULL ORDER BY qihao DESC LIMIT 100
--   - 覆盖索引，包含排序字段，性能最优








