# 加拿大VPS更新指令

> 加拿大VPS只负责采集PlayNow官方数据源，不执行统计和预测

## 什么时候需要更新VPS？

**需要更新：**
- ✅ 修改了数据采集逻辑
- ✅ 修改了数据写入逻辑
- ✅ 修改了数据库schema
- ✅ 修复了核心bug
- ✅ 更新了依赖包

**不需要更新：**
- ❌ 修改了AI预测逻辑
- ❌ 修改了Web前端
- ❌ 修改了API路由
- ❌ 修改了统计更新逻辑

## 一条命令更新（推荐）

SSH连接后复制粘贴执行：

```bash
ssh root@155.138.135.124
```

密码：`3aR+5%dRnch-H{W}`

然后执行：

```bash
cd ~/lottery-api && git pull && npm install && npm run build && pm2 restart lottery-api && pm2 logs --lines 30
```

**说明：** 这条命令会自动完成：拉取代码 → 安装依赖 → 编译 → 重启服务 → 查看日志

按 `Ctrl+C` 退出日志查看

---

## ⚠️ 重要：数据库连接数优化（2026-02-12）

**问题：** 之前配置的连接数过高（写库10 + 读库20 = 30），导致启动时超过数据库用户连接限制。

**解决方案：** 已优化连接池配置：
- 写库：5个连接（写操作较少）
- 读库：15个连接（读操作为主）
- 总计：20个连接（预留10个给其他进程）

**部署前检查：**
```bash
cd ~/lottery-api
bash deploy/pre-deploy-check.sh
```

**诊断工具：**
```bash
cd ~/lottery-api
node diagnose-connections.js
```

**如果仍然遇到连接数问题：**
1. 检查是否有其他进程占用连接：`pm2 list`
2. 停止所有进程：`pm2 stop all`
3. 等待30秒让连接释放
4. 重新启动：`pm2 start lottery-api`

---

## 分步更新（如遇问题）

如果一条命令执行失败，可以分步执行：

### 1. SSH连接
```bash
ssh root@155.138.135.124
```

### 2. 进入项目目录
```bash
cd ~/lottery-api
```

### 3. 拉取最新代码
```bash
git pull origin main
```

### 4. 安装依赖
```bash
npm install
```

### 5. 编译代码
```bash
npm run build
```

### 6. 重启服务
```bash
pm2 restart lottery-api
```

### 7. 查看日志
```bash
pm2 logs lottery-api --lines 50
```

### 8. 检查服务状态
```bash
pm2 status
```

---

## 验证更新

### 检查服务状态
```bash
pm2 status
```

应该看到 `lottery-api` 状态为 `online`

### 检查日志
```bash
pm2 logs lottery-api --lines 30
```

应该看到：
- ✅ 连接到PlayNow数据源
- ✅ 成功采集开奖数据
- ❌ 没有"更新统计"或"更新遗漏"的日志（因为IS_MAIN_SERVER=false）

### 检查配置
```bash
cat .env | grep -E "IS_MAIN_SERVER|ENABLE_PLAYNOW|ENABLE_OTHER_SOURCES"
```

应该显示：
```
IS_MAIN_SERVER=false
ENABLE_PLAYNOW=true
ENABLE_OTHER_SOURCES=false
```

---

## 常见问题

### 问题1：git pull失败

**错误：** `error: Your local changes would be overwritten`

**解决：**
```bash
git stash
git pull origin main
```

### 问题2：npm install失败

**错误：** 网络超时或依赖安装失败

**解决：**
```bash
# 清理缓存重试
npm cache clean --force
npm install
```

### 问题3：编译失败

**错误：** TypeScript编译错误

**解决：**
```bash
# 查看错误详情
npm run build

# 如果是依赖问题，重新安装
rm -rf node_modules
npm install
npm run build
```

### 问题4：PM2重启失败

**错误：** `lottery-api not found`

**解决：**
```bash
# 停止并删除旧进程
pm2 delete lottery-api

# 重新启动
pm2 start dist/app.js --name lottery-api

# 保存配置
pm2 save
```

### 问题5：VPS显示"更新统计"日志

**原因：** `IS_MAIN_SERVER` 配置错误

**解决：**
```bash
# 重新复制配置
cp deploy/env.canada .env

# 检查配置
cat .env | grep IS_MAIN_SERVER

# 重启服务
pm2 restart lottery-api
```

---

## 其他常用命令

```bash
# 查看实时日志
pm2 logs lottery-api

# 查看最近100行日志
pm2 logs lottery-api --lines 100

# 查看错误日志
pm2 logs lottery-api --err

# 停止服务
pm2 stop lottery-api

# 重启服务
pm2 restart lottery-api

# 查看服务详情
pm2 show lottery-api

# 监控资源使用
pm2 monit
```

---

## 相关文档

- [系统架构说明](../ARCHITECTURE.md) - 理解双服务器架构
- [环境变量配置](ENV_CONFIG.md) - 详细配置说明
- [VPS部署说明](README.md) - 初次部署指南





