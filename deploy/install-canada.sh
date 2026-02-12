#!/bin/bash
###############################################################################
# 加拿大VPS一键部署脚本 - 从GitHub部署
###############################################################################

set -e

echo "========================================="
echo "  PlayNow 数据采集服务部署"
echo "========================================="
echo ""

# 检查参数
if [ -z "$1" ]; then
    echo "用法: bash install-canada.sh <GitHub仓库地址>"
    echo "示例: bash install-canada.sh https://github.com/your-username/lottery-api"
    exit 1
fi

REPO_URL=$1

echo "[1/6] 更新系统..."
apt-get update -qq

echo "[2/6] 安装Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    apt-get install -y nodejs > /dev/null 2>&1
fi
echo "✓ Node.js $(node -v)"

echo "[3/6] 安装PM2和Git..."
npm install -g pm2 > /dev/null 2>&1
apt-get install -y git > /dev/null 2>&1
echo "✓ PM2和Git已安装"

echo "[4/6] 克隆代码..."
cd /opt
if [ -d "lottery-api" ]; then
    rm -rf lottery-api
fi
git clone $REPO_URL lottery-api
cd lottery-api
echo "✓ 代码克隆完成"

echo "[5/6] 安装依赖并编译..."
npm install --production > /dev/null 2>&1
npm run build > /dev/null 2>&1
echo "✓ 编译完成"

echo "[6/6] 配置并启动服务..."
cp deploy/env.canada .env
mkdir -p logs

cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'lottery-api',
    script: './dist/app.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      TZ: 'Asia/Shanghai'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
EOF

pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo ""
echo "========================================="
echo "  ✓ 部署完成！"
echo "========================================="
echo ""
echo "常用命令："
echo "  pm2 status    - 查看状态"
echo "  pm2 logs      - 查看日志"
echo "  pm2 restart all - 重启"
echo ""

