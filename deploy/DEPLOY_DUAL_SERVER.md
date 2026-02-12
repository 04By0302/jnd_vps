# 双端部署更新指令

## 修复内容
- ✅ 已修复双端部署导致的遗漏和统计数据冲突
- ✅ 添加 `IS_MAIN_SERVER` 环境变量控制统计更新
- ✅ 已校准数据库中的遗漏和统计数据

---

## 部署步骤

### 1️⃣ 停止服务（两个服务器都要执行）

**加拿大VPS:**
```bash
ssh root@155.138.135.124
cd ~/lottery-api
pm2 stop all
```

**香港服务器:**
在宝塔面板停止Node项目 `lottery-api`

---

### 2️⃣ 更新加拿大VPS

```bash
# SSH连接
ssh root@155.138.135.124

# 更新代码
cd ~/lottery-api
git pull origin main
npm install
npm run build

# 检查环境变量配置
cat .env | grep -E "IS_MAIN_SERVER|ENABLE_PLAYNOW|ENABLE_OTHER_SOURCES"
# 应该显示:
# IS_MAIN_SERVER=false
# ENABLE_PLAYNOW=true
# ENABLE_OTHER_SOURCES=false

# 如果不对,重新复制配置
cp deploy/env.canada .env

# 重启服务
pm2 restart all
pm2 logs --lines 20
```

---

### 3️⃣ 更新香港服务器

**在宝塔终端执行:**

```bash
cd /www/wwwroot/lottery-api
git pull origin main
npm install
npm run build

# 检查环境变量配置
cat .env | grep -E "IS_MAIN_SERVER|ENABLE_PLAYNOW|ENABLE_OTHER_SOURCES"
# 应该显示:
# IS_MAIN_SERVER=true (或不存在此行,默认true)
# ENABLE_PLAYNOW=false
# ENABLE_OTHER_SOURCES=true

# 如果ENABLE_PLAYNOW和ENABLE_OTHER_SOURCES不对,修改.env:
nano .env
# 添加或修改:
# IS_MAIN_SERVER=true
# ENABLE_PLAYNOW=false
# ENABLE_OTHER_SOURCES=true
```

**然后在宝塔面板启动Node项目 `lottery-api`**

---

## 4️⃣ 验证部署

### 检查加拿大VPS日志
```bash
ssh root@155.138.135.124
pm2 logs lottery-api --lines 50
```

应该看到:
- ✅ 连接到PlayNow数据源
- ✅ 成功采集开奖数据
- ❌ 没有"更新统计"或"更新遗漏"的日志（因为IS_MAIN_SERVER=false）

### 检查香港服务器日志
在宝塔面板查看日志，应该看到:
- ✅ 连接到laoyou28/duli28/gaga28/openjiang数据源
- ✅ 成功采集开奖数据
- ✅ 有"更新统计"和"更新遗漏"的日志（因为IS_MAIN_SERVER=true）

### 验证数据库
本地或任意终端执行:
```bash
npx tsx -e "
import { readDB } from './src/database/client';
(async () => {
  const omissions = await readDB.omission_data.findMany({ take: 3 });
  console.log('遗漏数据示例:', omissions);
  process.exit(0);
})();
"
```

遗漏值应该合理（不会有异常大的值）

---

## 配置说明

| 服务器 | IS_MAIN_SERVER | ENABLE_PLAYNOW | ENABLE_OTHER_SOURCES | 功能 |
|--------|----------------|----------------|----------------------|------|
| 香港主服务器 | true (默认) | false | true | 采集其他源+执行统计+API |
| 加拿大VPS | false | true | false | 仅采集官方源 |

---

## 问题排查

### 如果遗漏值仍然异常
1. 确认两个服务器的 `IS_MAIN_SERVER` 配置正确
2. 重启两个服务器的服务
3. 本地重新运行 `npx tsx calibrate-stats.ts`

### 如果PlayNow数据采集失败
在加拿大VPS测试:
```bash
curl --http1.1 -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://www.playnow.com/" \
  https://www.playnow.com/services2/keno/draw/latest/1
```

### 如果加拿大VPS显示"更新统计"日志
说明 `IS_MAIN_SERVER` 没有正确设置为 `false`，重新检查 `.env` 文件。





