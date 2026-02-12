#!/bin/bash

# 部署前检查脚本
# 确保环境配置正确，避免连接数超限问题

set -e

echo ""
echo "=========================================="
echo "   部署前环境检查"
echo "=========================================="
echo ""

# 1. 检查环境变量文件
if [ ! -f "deploy/env.canada" ]; then
    echo "❌ 错误: deploy/env.canada 文件不存在"
    exit 1
fi

echo "✅ 环境配置文件存在"
echo ""

# 2. 加载环境变量
source deploy/env.canada

# 3. 检查数据库连接配置
echo "📋 数据库连接配置:"
echo "   写库连接数: ${WRITE_DB_CONNECTION_LIMIT:-未设置}"
echo "   读库连接数: ${READ_DB_CONNECTION_LIMIT:-未设置}"

WRITE_LIMIT=${WRITE_DB_CONNECTION_LIMIT:-5}
READ_LIMIT=${READ_DB_CONNECTION_LIMIT:-15}
TOTAL=$((WRITE_LIMIT + READ_LIMIT))

echo "   总计: $TOTAL"
echo ""

# 4. 连接数安全检查
if [ $TOTAL -gt 25 ]; then
    echo "⚠️  警告: 总连接数 ($TOTAL) 可能超过数据库限制"
    echo "   建议: 降低连接数到 25 以下"
    echo ""
fi

if [ $TOTAL -le 25 ]; then
    echo "✅ 连接数配置安全 (总计: $TOTAL, 预留: $((30 - TOTAL)))"
    echo ""
fi

# 5. 检查必要的环境变量
echo "🔍 检查必要的环境变量..."

REQUIRED_VARS=(
    "WRITE_DB_HOST"
    "WRITE_DB_USER"
    "WRITE_DB_PASSWORD"
    "READ_DB_HOST"
    "READ_DB_USER"
    "READ_DB_PASSWORD"
    "REDIS_HOST"
    "REDIS_PASSWORD"
)

MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo "❌ 缺少必要的环境变量:"
    for var in "${MISSING_VARS[@]}"; do
        echo "   - $var"
    done
    exit 1
fi

echo "✅ 所有必要的环境变量已设置"
echo ""

# 6. 测试数据库连接（可选）
echo "🔌 测试数据库连接..."
if command -v node &> /dev/null; then
    if [ -f "diagnose-connections.js" ]; then
        node diagnose-connections.js
    else
        echo "⚠️  诊断脚本不存在，跳过连接测试"
    fi
else
    echo "⚠️  Node.js 未安装，跳过连接测试"
fi

echo ""
echo "=========================================="
echo "   ✅ 部署前检查完成"
echo "=========================================="
echo ""


