# GitHub上传指南

## 准备工作

确保已删除敏感信息和不必要的文件。

## 上传步骤

### 1. 初始化Git仓库

```bash
cd D:\Desktop\api
git init
```

### 2. 创建 .gitignore

```bash
# 依赖
node_modules/

# 编译输出
dist/

# 环境变量(包含敏感信息)
.env
.env.local
.env.*.local

# 日志
logs/
*.log

# 临时文件
*.tmp
*.temp

# 输出文件
output/

# 系统文件
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# 备份文件
*.bak
*.rar
*.zip
```

### 3. 添加文件并提交

```bash
git add .
git commit -m "Initial commit: Canada VPS lottery data collector"
```

### 4. 关联GitHub仓库

在GitHub创建新仓库后:

```bash
git remote add origin <你的GitHub仓库地址>
git branch -M main
git push -u origin main
```

## 加拿大VPS使用

部署到GitHub后,在加拿大VPS执行:

```bash
cd /opt
git clone <你的GitHub仓库地址> lottery-api
cd lottery-api
bash deploy/install-canada.sh
```

## 后续更新

本地修改后推送:

```bash
git add .
git commit -m "描述你的修改"
git push origin main
```

加拿大VPS更新:

```bash
cd /opt/lottery-api
git pull origin main
cp deploy/env.canada .env
npm install --production
npx prisma generate
npm run build
pm2 restart lottery-api
```

