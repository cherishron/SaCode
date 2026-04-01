# 故障排除指南

## 概述

本文档提供了 PIV 工作流中常见问题的解决方案，帮助您快速定位和解决问题。

## 常见问题

### 1. 类型错误

#### 症状
- TypeScript 编译失败
- 类型不匹配错误
- 属性不存在错误

#### 解决方案

```bash
# 1. 运行类型检查
!npx tsc --noEmit

# 2. 查看错误信息
"请查看 TypeScript 错误信息"

# 3. 修复类型错误
"请修复类型错误：
- 添加类型定义
- 使用类型守卫
- 明确接口定义"

# 4. 重新验证
!npx tsc --noEmit
```

#### 预防措施
- 启用 TypeScript 严格模式
- 避免使用 any 类型
- 使用类型注解
- 定期运行类型检查

### 2. 构建错误

#### 症状
- 构建失败
- 模块找不到
- 依赖冲突

#### 解决方案

```bash
# 1. 查看构建错误
!npm run build

# 2. 分析错误原因
"请分析构建错误的原因"

# 3. 清除缓存
!rm -rf .next
!rm -rf node_modules

# 4. 重新安装依赖
!npm install

# 5. 重新构建
!npm run build
```

#### 预防措施
- 定期更新依赖
- 使用 lock 文件
- 避免版本冲突
- 测试构建流程

### 3. 测试失败

#### 症状
- 测试失败
- 断言错误
- 超时错误

#### 解决方案

```bash
# 1. 运行测试
!npm test

# 2. 查看失败原因
"请查看测试失败的原因"

# 3. 运行特定测试
!npm test -- [测试文件名]

# 4. 调试测试
!npm test -- --debug

# 5. 修复问题
"请修复测试失败的问题"

# 6. 重新验证
!npm test
```

#### 预防措施
- 编写清晰的测试
- 使用适当的断言
- 设置合理的超时
- 定期运行测试

### 4. API 错误

#### 症状
- API 返回错误
- 404 Not Found
- 500 Internal Server Error

#### 解决方案

```bash
# 1. 测试 API 端点
!curl http://localhost:3000/api/endpoint

# 2. 查看错误日志
"请查看 API 错误日志"

# 3. 检查代码逻辑
@src/app/api/endpoint/route.ts

# 4. 修复错误
"请修复 API 错误：
- 检查路由配置
- 验证输入参数
- 完善错误处理"

# 5. 重新测试
"请重新测试 API 端点"
```

#### 预防措施
- 完善的错误处理
- 输入验证
- 适当的日志记录
- 单元测试覆盖

### 5. 数据库错误

#### 症状
- 数据库连接失败
- 查询错误
- 迁移失败

#### 解决方案

```bash
# 1. 检查数据库连接
!npm run prisma:studio

# 2. 查看数据库日志
"请查看数据库错误日志"

# 3. 重新生成 Prisma Client
!npm run prisma:generate

# 4. 重新运行迁移
!npm run prisma:migrate

# 5. 验证数据库
"请验证数据库操作"
```

#### 预防措施
- 定期备份数据
- 使用事务
- 优化查询
- 监控数据库性能

### 6. 样式错误

#### 症状
- 样式不生效
- Tailwind CSS 类名错误
- 响应式设计问题

#### 解决方案

```bash
# 1. 检查 Tailwind CSS 配置
@tailwind.config.js

# 2. 验证类名
"请检查 Tailwind CSS 类名是否正确"

# 3. 清除缓存
!rm -rf .next

# 4. 重新构建
!npm run build

# 5. 验证样式
"请验证样式是否正确"
```

#### 预防措施
- 使用正确的类名
- 测试响应式设计
- 避免自定义 CSS
- 保持样式一致性

## 调试技巧

### 1. 日志调试

```bash
# 查看应用日志
!npm run dev

# 查看错误日志
!npm run dev 2>&1 | grep error

# 查看构建日志
!npm run build 2>&1 | tee build.log
```

### 2. 断点调试

```bash
# 使用 Node.js 调试器
!node --inspect-brk src/app/api/endpoint/route.ts

# 使用 Chrome DevTools
# 打开 chrome://inspect
```

### 3. 性能分析

```bash
# 分析构建产物
!npm run build -- --analyze

# 检查包大小
!npm run build
!ls -lh .next/static

# 性能测试
!npm run lighthouse
```

## 紧急处理

### 1. 生产环境错误

```bash
# 1. 立即回滚
!npm run deploy:rollback

# 2. 查看日志
"请查看生产环境错误日志"

# 3. 修复问题
"请修复生产环境错误"

# 4. 重新部署
!npm run deploy
```

### 2. 数据库错误

```bash
# 1. 停止应用
!npm run stop

# 2. 备份数据库
!npm run db:backup

# 3. 修复数据库
"请修复数据库错误"

# 4. 验证数据
"请验证数据完整性"

# 5. 启动应用
!npm run start
```

### 3. 安全漏洞

```bash
# 1. 立即隔离
"请隔离受影响的系统"

# 2. 分析漏洞
"请分析安全漏洞"

# 3. 修复漏洞
"请修复安全漏洞"

# 4. 更新依赖
!npm audit fix

# 5. 重新部署
!npm run deploy
```

## 获取帮助

### 1. 查看文档

```bash
# 查看相关文档
@IFLOW.md
@docs/core/architecture.md
@docs/technical/api.md
```

### 2. 搜索问题

```bash
# 在项目中搜索相关代码
"请搜索 [关键词] 相关的代码"
```

### 3. 提问

```bash
# 向 AI 提问
"请帮我解决以下问题：[问题描述]"
```

## 预防措施

### 1. 定期备份

- 备份数据库
- 备份代码
- 备份配置文件

### 2. 监控系统

- 监控应用性能
- 监控错误日志
- 监控资源使用

### 3. 测试覆盖

- 单元测试
- 集成测试
- E2E 测试

### 4. 代码审查

- 实施代码审查
- 使用自动化工具
- 定期审查

## 参考资料

- [Javisk 方法论概述](../SKILL.md)
- [错误处理指南](../templates/error-handling.md)
- [最佳实践](./best-practices.md)
- [命令映射表](./commands-mapping.md)