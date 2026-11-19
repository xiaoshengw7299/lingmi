# Redis Module - Redis缓存模块

## 概述

Redis缓存模块为系统提供高性能的缓存服务，支持数据缓存、会话管理、队列处理等功能，提升系统整体性能和响应速度。

## 功能特性

- ⚡ **高性能缓存** - 基于Redis的高性能缓存服务
- 🔄 **会话管理** - 用户会话和令牌管理
- 📊 **数据缓存** - 热点数据缓存和查询优化
- 🔧 **配置管理** - 灵活的Redis配置管理
- 📝 **日志记录** - 完整的缓存操作日志

## 模块结构

```
redis/
├── redis.module.ts              # 模块定义
├── redis.service.ts             # Redis服务
├── redis.interface.ts           # Redis接口定义
└── redis-async-options.interface.ts # 异步配置接口
```

## 核心服务

### RedisService - Redis服务
提供Redis缓存的核心功能：
- 数据缓存和获取
- 会话管理
- 令牌存储
- 缓存清理

## 配置接口

### RedisAsyncOptions - 异步配置接口
```typescript
{
  host: string;                  // Redis主机地址
  port: number;                  // Redis端口
  password: string;              // Redis密码
  db: number;                    // 数据库编号
  keyPrefix: string;             // 键前缀
}
```

## 使用示例

### 缓存数据
```typescript
// 设置缓存
await redisService.set('key', 'value', 3600);

// 获取缓存
const value = await redisService.get('key');
```

### 会话管理
```typescript
// 存储用户会话
await redisService.setSession(userId, sessionData);

// 获取用户会话
const session = await redisService.getSession(userId);
```

## 依赖关系

- **@nestjs/redis**: Redis客户端
- **ioredis**: Redis驱动
