# 快速部署指南

## 已完成的优化

✅ 删除Cloudflare缓存清理逻辑
✅ 优化数据库连接池(空闲回收、连接监控、指数退避重连)
✅ 修正加拿大VPS配置(只启动1个PlayNow数据源)
✅ 删除本地前端文件
✅ 编译通过

## 您需要做的事情

### 1. 上传到GitHub

```bash
cd D:\Desktop\api

# 初始化Git
git init
git add .
git commit -m "优化数据库连接和加拿大VPS配置"

# 关联GitHub仓库(替换为您的仓库地址)
git remote add origin <您的GitHub仓库地址>
git branch -M main
git push -u origin main
```

### 2. 加拿大VPS部署(SSH命令)

登录加拿大VPS后,复制粘贴以下命令:

```bash
# 进入目录
cd /opt

# 克隆代码(替换为您的GitHub仓库地址)
git clone <您的GitHub仓库地址> lottery-api
cd lottery-api

# 安装依赖
npm install --production

# 配置环境变量
cp deploy/env.canada .env

# 生成Prisma客户端
npx prisma generate

# 编译
npm run build

# 启动服务
pm2 start dist/app.js --name lottery-api --max-memory-restart 1G
pm2 save
pm2 startup

# 查看日志(确认显示"已启动 1 个数据源抓取器")
pm2 logs lottery-api --lines 50
```

### 3. 后续更新命令

```bash
cd /opt/lottery-api
git pull origin main
cp deploy/env.canada .env
npm install --production
npx prisma generate
npm run build
pm2 restart lottery-api
pm2 logs lottery-api --lines 50
```

## 验证成功

日志应该显示:
```
[成功] 已启动 1 个数据源抓取器
数据源配置加载 enablePlayNow: true, enableOtherSources: false, totalSources: 1
```

## 注意事项

- 本地代码已删除public目录,前端文件请单独上传到香港服务器
- 加拿大VPS使用deploy/env.canada配置
- 香港主服务器使用.env配置(需要设置ENABLE_PLAYNOW=false, ENABLE_OTHER_SOURCES=true)

