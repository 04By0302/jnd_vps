# 本地开发指南

> 本文档适用于在Windows本地环境进行开发和调试

## 快速开始

### 1. 环境要求

- Node.js 20.x
- Git
- 代码编辑器（推荐 VS Code 或 Cursor）

### 2. 初始化项目

```bash
# 克隆项目
git clone <repository-url>
cd api

# 安装依赖
npm install

# 生成Prisma客户端
npx prisma generate
```

### 3. 配置环境变量

```bash
# 复制本地开发配置
cp .env.local.example .env
```

**重要：** 本地开发配置已经优化了数据库连接数（2写/5读），避免占满生产数据库连接池。

### 4. 启动开发服务器

```bash
# 开发模式（自动重启）
npm run dev

# 或者先编译再运行
npm run build
npm start
```

### 5. 访问服务

- Web API: http://localhost:9797
- 健康检查: http://localhost:9797/health
- 开奖数据: http://localhost:9797/kj.json?limit=10

## 配置说明

### 本地开发环境特点

本地开发环境 = 香港服务器环境（主程序），具有完整功能：

- ✅ 采集4个第三方数据源（laoyou28, duli28, gaga28, openjiang）
- ✅ 执行统计更新（遗漏数据、每日统计）
- ✅ 执行AI预测（单双、大小、组合）
- ✅ 提供Web API服务
- ✅ 连接生产数据库（阿里云RDS）
- ✅ 连接生产Redis（阿里云Redis）

### 关键配置项

```bash
# 主服务器模式（执行统计和预测）
IS_MAIN_SERVER=true

# 启用4个第三方数据源
ENABLE_OTHER_SOURCES=true

# 不启用PlayNow（需要加拿大IP）
ENABLE_PLAYNOW=false

# 最小连接数（避免占满连接池）
WRITE_DB_CONNECTION_LIMIT=2
READ_DB_CONNECTION_LIMIT=5

# 开发模式
NODE_ENV=development
LOG_LEVEL=debug
```

## 常用命令

### 开发命令

```bash
# 启动开发服务器（自动重启）
npm run dev

# 编译TypeScript
npm run build

# 启动生产模式
npm start

# 生成Prisma客户端
npx prisma generate

# 查看数据库迁移状态
npx prisma migrate status
```

### 调试命令

```bash
# 查看数据库连接
npx tsx -e "
import { readDB } from './src/database/client';
(async () => {
  const count = await readDB.lottery_data.count();
  console.log('数据总数:', count);
  process.exit(0);
})();
"

# 查看Redis连接
npx tsx -e "
import { getRedisClient } from './src/libs/redis';
(async () => {
  const redis = getRedisClient();
  const keys = await redis.keys('*');
  console.log('Redis键数量:', keys.length);
  process.exit(0);
})();
"
```

## 常见问题

### 1. 数据库连接数过多

**错误信息：**
```
ERROR 42000 (1203): User new_api already has more than 'max_user_connections' active connections
```

**原因：** `.env` 中的连接数配置过大，或有多个Node进程在运行

**解决方案：**

```bash
# 1. 停止所有Node进程
taskkill /F /IM node.exe

# 2. 等待30秒让数据库连接释放

# 3. 确认使用正确的配置
# 检查 .env 文件中的连接数配置
# WRITE_DB_CONNECTION_LIMIT=2
# READ_DB_CONNECTION_LIMIT=5

# 4. 重新启动
npm run dev
```

### 2. Redis连接超时

**错误信息：**
```
Redis connection timeout
```

**原因：** 网络问题或Redis服务不可用

**解决方案：**

```bash
# 检查网络连接
ping r-bp1m85dvrgmkgmdipfpd.redis.rds.aliyuncs.com

# 检查Redis配置
# REDIS_CONNECT_TIMEOUT=30000
# REDIS_COMMAND_TIMEOUT=15000
```

### 3. 无法采集PlayNow数据

**问题：** 本地无法采集PlayNow官方数据源

**原因：** PlayNow官方源需要加拿大IP地址

**解决方案：** 
- 本地开发不需要测试PlayNow数据源
- PlayNow数据由加拿大VPS负责采集
- 如需测试PlayNow相关功能，使用已有的数据库数据

### 4. Prisma客户端版本不匹配

**错误信息：**
```
Prisma Client version mismatch
```

**解决方案：**

```bash
# 重新生成Prisma客户端
npx prisma generate

# 如果还有问题，清理并重新安装
rm -rf node_modules
npm install
npx prisma generate
```

### 5. 端口被占用

**错误信息：**
```
Error: listen EADDRINUSE: address already in use :::9797
```

**解决方案：**

```bash
# 查找占用端口的进程
netstat -ano | findstr :9797

# 停止该进程（替换PID）
taskkill /F /PID <PID>

# 或者停止所有Node进程
taskkill /F /IM node.exe
```

## 开发工作流

### 日常开发流程

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 安装新依赖（如果有）
npm install

# 3. 启动开发服务器
npm run dev

# 4. 进行开发和测试

# 5. 提交代码
git add .
git commit -m "描述修改内容"
git push origin main
```

### 测试流程

```bash
# 1. 启动开发服务器
npm run dev

# 2. 测试API接口
curl http://localhost:9797/kj.json?limit=5

# 3. 查看日志输出
# 控制台会显示详细的debug日志

# 4. 测试数据采集
# 等待数据源自动采集，观察日志

# 5. 测试AI预测
# 新数据写入后会自动触发预测
```

## 调试技巧

### 1. 使用VS Code调试

创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Dev Server",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "skipFiles": ["<node_internals>/**"],
      "env": {
        "TZ": "Asia/Shanghai"
      }
    }
  ]
}
```

### 2. 查看详细日志

```bash
# 设置日志级别为debug
# 在 .env 中设置
LOG_LEVEL=debug
```

### 3. 监控数据库查询

```typescript
// 在代码中添加日志
import { logger } from './libs/logger';

logger.debug({ query: 'SELECT * FROM lottery_data' }, '执行查询');
```

### 4. 监控Redis操作

```typescript
// 在代码中添加日志
import { logger } from './libs/logger';

logger.debug({ key: 'cache:key', value: data }, 'Redis操作');
```

## 性能优化建议

### 1. 数据库连接

- 本地开发使用最小连接数（2写/5读）
- 避免长时间运行多个开发实例
- 定期重启开发服务器释放连接

### 2. Redis缓存

- 开发时可以手动清除缓存测试
- 使用Redis Desktop Manager查看缓存状态

### 3. 内存使用

- 监控Node进程内存使用
- 如果内存过高，重启开发服务器

## 与生产环境的区别

| 项目 | 本地开发 | 香港服务器 |
|------|----------|------------|
| 数据库连接数 | 2写/5读 | 25写/50读 |
| 日志级别 | debug | info |
| NODE_ENV | development | production |
| 进程管理 | 手动启动 | PM2/宝塔 |
| 数据源 | 4个第三方源 | 4个第三方源 |
| 统计更新 | ✅ | ✅ |
| AI预测 | ✅ | ✅ |
| Web API | ✅ | ✅ |

## 不能在本地测试的功能

- ❌ PlayNow官方源采集（需要加拿大IP）
- ❌ 大规模并发测试（连接数限制）
- ❌ 长时间稳定性测试（建议在服务器测试）

## 相关文档

- [系统架构说明](ARCHITECTURE.md) - 理解整体架构
- [加拿大VPS更新](deploy/UPDATE_CANADA_VPS.md) - VPS更新流程
- [环境变量配置](deploy/ENV_CONFIG.md) - 详细配置说明

## 获取帮助

如遇到问题：

1. 查看本文档的"常见问题"部分
2. 查看控制台日志输出
3. 检查 `.env` 配置是否正确
4. 确认数据库和Redis连接正常
5. 查看 [ARCHITECTURE.md](ARCHITECTURE.md) 了解系统架构


