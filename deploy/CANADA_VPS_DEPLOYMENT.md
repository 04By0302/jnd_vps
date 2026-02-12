# 加拿大VPS部署指南

## 服务器配置说明

**加拿大VPS角色**: 仅采集PlayNow官方开奖源

**配置特点**:
- 只启动1个数据源抓取器(PlayNow Keno)
- 不执行统计更新任务
- 共享香港主服务器的数据库和Redis

## 环境变量配置

文件: `deploy/env.canada`

关键配置:
```bash
# 数据源控制
ENABLE_PLAYNOW=true              # 启用PlayNow官方源
ENABLE_OTHER_SOURCES=false       # 禁用其他数据源
IS_MAIN_SERVER=false             # 不执行统计更新
```

## SSH部署命令

### 首次部署

```bash
# 1. 克隆代码
cd /opt
git clone <你的GitHub仓库地址> lottery-api
cd lottery-api

# 2. 安装依赖
npm install --production

# 3. 配置环境变量
cp deploy/env.canada .env

# 4. 生成Prisma客户端
npx prisma generate

# 5. 编译TypeScript
npm run build

# 6. 启动服务
pm2 start dist/app.js --name lottery-api
pm2 save
pm2 startup
```

### 日常更新

```bash
# SSH登录后执行
cd /opt/lottery-api

# 拉取最新代码
git pull origin main

# 复制环境配置
cp deploy/env.canada .env

# 安装依赖
npm install --production

# 生成Prisma客户端
npx prisma generate

# 编译
npm run build

# 重启服务
pm2 restart lottery-api

# 查看日志(确认只启动1个数据源)
pm2 logs lottery-api --lines 50
```

### 快速更新脚本

也可以使用提供的更新脚本:

```bash
cd /opt/lottery-api
bash deploy/install-canada-simple.sh
```

## 验证部署

启动后检查日志,应该看到:

```
[成功] 已启动 1 个数据源抓取器
数据源配置加载 enablePlayNow: true, enableOtherSources: false, totalSources: 1
```

## 常用PM2命令

```bash
pm2 status              # 查看服务状态
pm2 logs lottery-api    # 查看实时日志
pm2 restart lottery-api # 重启服务
pm2 stop lottery-api    # 停止服务
pm2 delete lottery-api  # 删除服务
```

## 故障排查

### 问题1: 启动了多个数据源

检查 `.env` 文件:
```bash
cat .env | grep ENABLE
```

应该显示:
```
ENABLE_PLAYNOW=true
ENABLE_OTHER_SOURCES=false
```

### 问题2: 数据库连接失败

检查网络连接:
```bash
telnet rm-bp14172o6ehyk82g0vo.mysql.rds.aliyuncs.com 3306
```

检查Redis连接:
```bash
telnet r-bp1m85dvrgmkgmdipfpd.redis.rds.aliyuncs.com 6379
```

### 问题3: 服务频繁重启

查看错误日志:
```bash
pm2 logs lottery-api --err --lines 100
```

## 性能监控

```bash
# 查看资源占用
pm2 monit

# 查看详细信息
pm2 show lottery-api
```

