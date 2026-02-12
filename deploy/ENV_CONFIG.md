# 双端部署环境变量配置说明

## 服务器角色配置

### IS_MAIN_SERVER
- **作用**: 控制是否执行统计更新（遗漏数据和每日统计）
- **默认值**: 未设置时默认为 `true`（兼容单机部署）
- **配置规则**:
  - **香港主服务器**: `IS_MAIN_SERVER=true` 或不设置
  - **加拿大辅助VPS**: `IS_MAIN_SERVER=false`（必须显式设置）

## 数据源配置

### ENABLE_PLAYNOW
- **作用**: 控制是否采集PlayNow官方数据源
- **配置规则**:
  - **香港主服务器**: `ENABLE_PLAYNOW=false`
  - **加拿大辅助VPS**: `ENABLE_PLAYNOW=true`

### ENABLE_OTHER_SOURCES
- **作用**: 控制是否采集其他数据源（laoyou28, duli28, gaga28, openjiang）
- **配置规则**:
  - **香港主服务器**: `ENABLE_OTHER_SOURCES=true`
  - **加拿大辅助VPS**: `ENABLE_OTHER_SOURCES=false`

## 双端部署架构

```
香港主服务器（全功能）:
  - 采集: laoyou28, duli28, gaga28, openjiang
  - 执行: 遗漏统计 + 每日统计
  - 提供: API服务
  - 配置: IS_MAIN_SERVER=true, ENABLE_PLAYNOW=false, ENABLE_OTHER_SOURCES=true

加拿大辅助VPS（仅采集）:
  - 采集: PlayNow官方源
  - 执行: 无统计更新
  - 配置: IS_MAIN_SERVER=false, ENABLE_PLAYNOW=true, ENABLE_OTHER_SOURCES=false
```

## 配置文件位置

- **加拿大VPS**: `deploy/env.canada`
- **香港服务器**: `.env`（需手动创建或从 `deploy/env.canada` 复制并修改）





