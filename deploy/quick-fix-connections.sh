#!/bin/bash

# 快速修复数据库连接数问题
# 用于紧急部署连接池优化

set -e

echo ""
echo "=========================================="
echo "   数据库连接池快速修复"
echo "=========================================="
echo ""

# 1. 停止服务
echo "🛑 停止服务..."
pm2 stop lottery-api || true
echo "   等待30秒，让所有连接释放..."
sleep 30
echo ""

# 2. 备份当前环境配置
echo "💾 备份环境配置..."
if [ -f ".env" ]; then
    cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
    echo "   ✅ 已备份到 .env.backup.$(date +%Y%m%d_%H%M%S)"
fi
echo ""

# 3. 更新环境配置
echo "⚙️  更新环境配置..."
if [ -f "deploy/env.canada" ]; then
    cp deploy/env.canada .env
    echo "   ✅ 已复制 deploy/env.canada 到 .env"
else
    echo "   ❌ 错误: deploy/env.canada 不存在"
    exit 1
fi
echo ""

# 4. 显示新配置
echo "📋 新的连接池配置:"
source .env
echo "   写库连接数: ${WRITE_DB_CONNECTION_LIMIT}"
echo "   读库连接数: ${READ_DB_CONNECTION_LIMIT}"
echo "   总计: $((WRITE_DB_CONNECTION_LIMIT + READ_DB_CONNECTION_LIMIT))"
echo ""

# 5. 运行诊断
echo "🔍 运行连接诊断..."
if [ -f "diagnose-connections.js" ]; then
    node diagnose-connections.js || true
else
    echo "   ⚠️  诊断脚本不存在，跳过"
fi
echo ""

# 6. 启动服务
echo "🚀 启动服务..."
pm2 start lottery-api
echo ""

# 7. 等待启动
echo "⏳ 等待服务启动..."
sleep 5
echo ""

# 8. 查看日志
echo "📋 查看启动日志..."
pm2 logs lottery-api --lines 50 --nostream
echo ""

# 9. 检查状态
echo "✅ 检查服务状态..."
pm2 status lottery-api
echo ""

echo "=========================================="
echo "   修复完成"
echo "=========================================="
echo ""
echo "💡 提示:"
echo "   - 使用 'pm2 logs lottery-api' 查看实时日志"
echo "   - 使用 'node diagnose-connections.js' 诊断连接"
echo "   - 如果仍有问题，查看 CONNECTION_POOL_OPTIMIZATION.md"
echo ""


