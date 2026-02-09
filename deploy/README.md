# 加拿大VPS部署说明

## 服务器信息

- **IP**: 155.138.135.124
- **用户**: root
- **位置**: Vultr Toronto
- **用途**: 采集PlayNow Keno官方数据源

## 一键部署命令

SSH登录后执行：

```bash
cd /opt && \
apt-get update -qq && \
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
apt-get install -y nodejs git && \
npm install -g pm2 && \
git clone https://github.com/04By0302/jnd_vps.git lottery-api && \
cd lottery-api && \
npm install --production && \
npm run build && \
cp deploy/env.canada .env && \
mkdir -p logs && \
cat > ecosystem.config.js << 'EOFPM2'
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
EOFPM2
pm2 start ecosystem.config.js && \
pm2 save && \
pm2 startup && \
pm2 logs
```

## 更新代码

```bash
cd /opt/lottery-api && \
git pull && \
npm install --production && \
npm run build && \
pm2 restart all
```

## 常用命令

```bash
pm2 status              # 查看状态
pm2 logs                # 查看日志
pm2 logs --lines 100    # 查看最近100行日志
pm2 restart all         # 重启服务
pm2 stop all            # 停止服务
pm2 monit               # 实时监控
```

## 数据源配置

当前启用的数据源：
- ✅ **PlayNow Keno** (官方源) - 需要加拿大IP
- ✅ **OpenJiang** (第三方源)

环境变量：
- `ENABLE_PLAYNOW=true` - 启用PlayNow官方源
- `ENABLE_OTHER_SOURCES=true` - 启用其他数据源

## 故障排查

### 查看错误日志
```bash
pm2 logs --err
```

### 查看最近的错误
```bash
tail -f /opt/lottery-api/logs/err.log
```

### 测试PlayNow连接
```bash
curl --http1.1 -H "User-Agent: Mozilla/5.0" -H "Referer: https://www.playnow.com/" https://www.playnow.com/services2/keno/draw/latest/1
```

### 重启服务
```bash
cd /opt/lottery-api && pm2 restart all
```

