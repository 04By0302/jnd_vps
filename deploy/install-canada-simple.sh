#!/bin/bash
# 加拿大VPS一键更新脚本

echo "=========================================="
echo "加拿大VPS更新脚本"
echo "=========================================="

# 进入项目目录
cd ~/api || exit 1

# 拉取最新代码
echo "1. 拉取最新代码..."
git pull origin main

# 复制环境配置
echo "2. 配置环境变量..."
cp deploy/env.canada .env

# 安装依赖
echo "3. 安装依赖..."
npm install

# 生成Prisma客户端
echo "4. 生成Prisma客户端..."
npx prisma@5.22.0 generate

# 构建项目
echo "5. 构建项目..."
npm run build

# 重启服务
echo "6. 重启服务..."
pm2 restart all

# 查看日志
echo "7. 查看日志..."
pm2 logs --lines 20

echo "=========================================="
echo "✅ 更新完成！"
echo "=========================================="


