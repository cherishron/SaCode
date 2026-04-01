# 错误处理指南

## 常见错误类型

### 1. TypeScript 类型错误

#### 错误示例
```typescript
// 错误：隐式 any 类型
function processData(data) {
  return data.value;
}

// 错误：类型不匹配
const result: string = 123;

// 错误：属性不存在
interface User {
  name: string;
}
const user: User = { name: 'John' };
console.log(user.age); // Property 'age' does not exist
```

#### 解决方案
```typescript
// 正确：明确类型定义
interface Data {
  value: string;
}

function processData(data: Data) {
  return data.value;
}

// 正确：类型匹配
const result: string = '123';

// 正确：可选属性
interface User {
  name: string;
  age?: number;
}
const user: User = { name: 'John' };
console.log(user.age); // undefined
```

#### 处理流程
1. 运行类型检查：`!npx tsc --noEmit`
2. 查看错误信息
3. 定位错误位置
4. 修复类型错误
5. 重新验证

### 2. 构建错误

#### 常见构建错误
- 依赖缺失
- 配置错误
- 路径错误
- 版本冲突

#### 处理流程
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

### 3. 测试失败

#### 处理流程
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

### 4. API 错误

#### 常见 API 错误
- 404 Not Found
- 500 Internal Server Error
- 400 Bad Request
- 403 Forbidden

#### 处理流程
```bash
# 1. 测试 API 端点
!curl http://localhost:3000/api/endpoint

# 2. 查看错误日志
"请查看 API 错误日志"

# 3. 检查代码逻辑
@src/app/api/endpoint/route.ts

# 4. 修复错误
"请修复 API 错误"

# 5. 重新测试
"请重新测试 API 端点"
```

### 5. 数据库错误

#### 常见数据库错误
- 连接失败
- 查询错误
- 迁移失败
- 数据完整性错误

#### 处理流程
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

### 6. 样式错误

#### 常见样式错误
- Tailwind CSS 类名错误
- 样式冲突
- 响应式设计错误
- 样式不生效

#### 处理流程
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

## 错误处理流程

### 标准流程

```
1. 识别错误
   ↓
2. 分析错误原因
   ↓
3. 制定修复方案
   ↓
4. 执行修复
   ↓
5. 验证修复结果
   ↓
6. 更新文档
   ↓
7. 记录经验
```

### 错误记录模板

```markdown
## 错误记录

**错误日期**：[日期]
**错误类型**：[类型]
**严重程度**：高/中/低

### 错误描述
[详细描述错误现象]

### 错误信息
```
[错误信息]
```

### 错误原因
[分析错误原因]

### 解决方案
[描述解决方案]

### 实施步骤
1. [步骤1]
2. [步骤2]
3. [步骤3]

### 验证结果
- [ ] 错误已解决
- [ ] 功能正常
- [ ] 测试通过

### 预防措施
[描述如何预防类似错误]

### 经验总结
[总结经验教训]
```

## 预防措施

### 1. 类型安全
- 启用 TypeScript 严格模式
- 避免使用 any 类型
- 使用类型守卫
- 定期运行类型检查

### 2. 代码审查
- 实施代码审查流程
- 使用自动化审查工具
- 定期进行代码审查
- 记录审查结果

### 3. 测试覆盖
- 编写单元测试
- 编写集成测试
- 编写 E2E 测试
- 定期运行测试

### 4. 文档维护
- 及时更新文档
- 编写清晰的注释
- 提供使用示例
- 记录变更历史

### 5. 监控和日志
- 实施错误监控
- 记录详细日志
- 定期查看日志
- 分析错误模式

## 故障排除工具

### 1. 调试工具
```bash
# TypeScript 类型检查
!npx tsc --noEmit

# ESLint 检查
!npx eslint .

# Prettier 格式化
!npx prettier --write .

# 构建检查
!npm run build
```

### 2. 日志工具
```bash
# 查看应用日志
!npm run dev

# 查看错误日志
!npm run dev 2>&1 | grep error

# 查看构建日志
!npm run build 2>&1 | tee build.log
```

### 3. 测试工具
```bash
# 运行所有测试
!npm test

# 运行特定测试
!npm test -- [测试文件名]

# 生成覆盖率报告
!npm run test:coverage

# 监听模式
!npm test -- --watch
```

### 4. 性能工具
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

## 参考资料

- [故障排除指南](../resources/troubleshooting.md)
- [最佳实践](../resources/best-practices.md)
- [命令映射表](../resources/commands-mapping.md)