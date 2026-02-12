-- 初始化遗漏数据表
-- 为所有49种类型创建初始记录

-- 清空表（如果有旧数据）
TRUNCATE TABLE omission_data;

-- 插入基础类型（21种）
INSERT INTO omission_data (omission_type, omission_count, updated_at) VALUES
('da', 0, NOW()),
('xiao', 0, NOW()),
('dan', 0, NOW()),
('shuang', 0, NOW()),
('dd', 0, NOW()),
('xd', 0, NOW()),
('ds', 0, NOW()),
('xs', 0, NOW()),
('jd', 0, NOW()),
('jx', 0, NOW()),
('dz', 0, NOW()),
('sz', 0, NOW()),
('bz', 0, NOW()),
('zl', 0, NOW()),
('xb', 0, NOW()),
('zhong', 0, NOW()),
('db', 0, NOW()),
('bian', 0, NOW()),
('long', 0, NOW()),
('hu', 0, NOW()),
('he', 0, NOW())
ON DUPLICATE KEY UPDATE omission_count = 0, updated_at = NOW();

-- 插入和值类型（00-27，共28种）
INSERT INTO omission_data (omission_type, omission_count, updated_at) VALUES
('00', 0, NOW()),
('01', 0, NOW()),
('02', 0, NOW()),
('03', 0, NOW()),
('04', 0, NOW()),
('05', 0, NOW()),
('06', 0, NOW()),
('07', 0, NOW()),
('08', 0, NOW()),
('09', 0, NOW()),
('10', 0, NOW()),
('11', 0, NOW()),
('12', 0, NOW()),
('13', 0, NOW()),
('14', 0, NOW()),
('15', 0, NOW()),
('16', 0, NOW()),
('17', 0, NOW()),
('18', 0, NOW()),
('19', 0, NOW()),
('20', 0, NOW()),
('21', 0, NOW()),
('22', 0, NOW()),
('23', 0, NOW()),
('24', 0, NOW()),
('25', 0, NOW()),
('26', 0, NOW()),
('27', 0, NOW())
ON DUPLICATE KEY UPDATE omission_count = 0, updated_at = NOW();

