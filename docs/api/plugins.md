# 插件管理 API

> 插件系统的完整 REST API 文档

---

## 概述

插件管理 API 提供插件的发现、安装、启用/禁用、配置管理和卸载等功能。

**基础路径**: `/api/plugins`

**认证**: 所有端点需要 Bearer Token 认证

---

## 端点列表

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/plugins` | 获取插件列表 |
| GET | `/api/plugins/stats` | 获取插件统计 |
| GET | `/api/plugins/discover` | 发现可用插件 |
| GET | `/api/plugins/:name` | 获取插件详情 |
| POST | `/api/plugins` | 安装插件 |
| POST | `/api/plugins/:name/enable` | 启用插件 |
| POST | `/api/plugins/:name/disable` | 禁用插件 |
| POST | `/api/plugins/:name/reload` | 重载插件 |
| DELETE | `/api/plugins/:name` | 卸载插件 |
| GET | `/api/plugins/:name/config` | 获取插件配置 |
| PUT | `/api/plugins/:name/config` | 更新插件配置 |
| POST | `/api/plugins/:name/validate` | 验证插件配置 |

---

## 详细说明

### 获取插件列表

获取所有插件的列表，支持按状态过滤。

```http
GET /api/plugins?status=enabled
```

**查询参数**:

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| status | string | 否 | 过滤状态: discovered, installed, enabled, disabled, error |

**响应示例**:

```json
[
  {
    "name": "xiaoyi",
    "version": "1.0.0",
    "description": "华为小艺 AI 助手集成插件",
    "author": "STAND-ALONE",
    "status": "enabled",
    "enabled": true,
    "config": {
      "region": "cn-north-4",
      "timeout": 30000
    },
    "tags": ["ai", "assistant", "huawei"]
  }
]
```

---

### 获取插件统计

获取插件的统计信息。

```http
GET /api/plugins/stats
```

**响应示例**:

```json
{
  "total": 5,
  "installed": 3,
  "enabled": 2,
  "disabled": 1,
  "error": 0
}
```

---

### 发现可用插件

扫描插件目录，发现所有可用插件。

```http
GET /api/plugins/discover
```

**响应示例**:

```json
[
  {
    "name": "xiaoyi",
    "version": "1.0.0",
    "description": "华为小艺 AI 助手集成插件",
    "author": "STAND-ALONE",
    "status": "discovered",
    "tags": ["ai", "assistant", "huawei"]
  },
  {
    "name": "weather",
    "version": "1.2.0",
    "description": "天气查询插件",
    "author": "community",
    "status": "discovered",
    "tags": ["weather", "api"]
  }
]
```

---

### 获取插件详情

获取单个插件的详细信息，包括能力定义。

```http
GET /api/plugins/:name
```

**路径参数**:

| 参数 | 类型 | 描述 |
|------|------|------|
| name | string | 插件名称 |

**响应示例**:

```json
{
  "name": "xiaoyi",
  "version": "1.0.0",
  "manifest": {
    "name": "xiaoyi",
    "version": "1.0.0",
    "description": "华为小艺 AI 助手集成插件",
    "main": "index.ts",
    "config": {
      "ak": {
        "type": "string",
        "description": "华为云 Access Key",
        "required": true
      },
      "sk": {
        "type": "string",
        "description": "华为云 Secret Key",
        "required": true
      },
      "region": {
        "type": "string",
        "description": "华为云区域",
        "default": "cn-north-4",
        "enum": ["cn-north-4", "cn-east-3", "cn-south-1"]
      }
    }
  },
  "status": "enabled",
  "enabled": true,
  "config": {
    "region": "cn-north-4",
    "timeout": 30000
  },
  "capabilities": {
    "tools": [
      {
        "name": "xiaoyi_chat",
        "description": "与小艺 AI 进行对话"
      },
      {
        "name": "xiaoyi_status",
        "description": "获取小艺连接状态"
      }
    ],
    "commands": [
      {
        "name": "xiaoyi",
        "description": "与小艺对话",
        "aliases": ["xy"]
      }
    ],
    "messageHandlers": 1,
    "scheduledTasks": 0
  }
}
```

---

### 安装插件

安装一个已发现的插件。

```http
POST /api/plugins
```

**请求体**:

```json
{
  "name": "xiaoyi",
  "source": null,
  "config": {
    "region": "cn-north-4",
    "timeout": 30000
  }
}
```

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| name | string | 是 | 插件名称 |
| source | string | 否 | 外部源地址（预留） |
| config | object | 否 | 初始配置 |

**响应示例**:

```json
{
  "name": "xiaoyi",
  "version": "1.0.0",
  "status": "installed"
}
```

**错误响应**:

| 状态码 | 错误信息 |
|--------|----------|
| 400 | Plugin name is required |
| 400 | Plugin not found |
| 400 | Plugin is already installed |
| 400 | Missing required configuration: ak, sk |

---

### 启用插件

启用一个已安装的插件。

```http
POST /api/plugins/:name/enable
```

**响应示例**:

```json
{
  "success": true,
  "name": "xiaoyi",
  "status": "enabled"
}
```

**错误响应**:

| 状态码 | 错误信息 |
|--------|----------|
| 400 | Plugin not found |
| 400 | Missing dependency: other-plugin@1.0.0 |
| 400 | Dependency not enabled: other-plugin |

---

### 禁用插件

禁用一个已启用的插件。

```http
POST /api/plugins/:name/disable
```

**响应示例**:

```json
{
  "success": true,
  "name": "xiaoyi",
  "status": "disabled"
}
```

---

### 重载插件

重新加载插件代码和配置。

```http
POST /api/plugins/:name/reload
```

**响应示例**:

```json
{
  "success": true,
  "name": "xiaoyi",
  "version": "1.0.0",
  "status": "enabled"
}
```

---

### 卸载插件

卸载并删除插件。

```http
DELETE /api/plugins/:name
```

**响应示例**:

```json
{
  "success": true,
  "name": "xiaoyi"
}
```

---

### 获取插件配置

获取插件的当前配置。

```http
GET /api/plugins/:name/config
```

**响应示例**:

```json
{
  "ak": "***",
  "sk": "***",
  "region": "cn-north-4",
  "timeout": 30000,
  "reconnectInterval": 5000
}
```

---

### 更新插件配置

更新插件配置，会触发 `onConfigChange` 钩子。

```http
PUT /api/plugins/:name/config
```

**请求体**:

```json
{
  "config": {
    "timeout": 60000,
    "reconnectInterval": 3000
  }
}
```

**响应示例**:

```json
{
  "success": true,
  "config": {
    "ak": "***",
    "sk": "***",
    "region": "cn-north-4",
    "timeout": 60000,
    "reconnectInterval": 3000
  }
}
```

**错误响应**:

| 状态码 | 错误信息 |
|--------|----------|
| 400 | Config object is required |
| 400 | Config validation failed |
| 400 | Required config "ak" is missing |

---

### 验证插件配置

验证配置值是否符合 schema 定义。

```http
POST /api/plugins/:name/validate
```

**请求体**:

```json
{
  "config": {
    "region": "invalid-region",
    "timeout": 100
  }
}
```

**响应示例**:

```json
{
  "valid": false,
  "errors": [
    "Config \"region\" must be one of: cn-north-4, cn-east-3, cn-south-1",
    "Config \"timeout\" must be >= 5000"
  ],
  "warnings": [
    "Optional config \"reconnectInterval\" is not set"
  ]
}
```

---

## 插件状态

| 状态 | 描述 |
|------|------|
| `discovered` | 已发现但未安装 |
| `installed` | 已安装但未启用 |
| `enabled` | 已启用，正在运行 |
| `disabled` | 已禁用 |
| `error` | 错误状态 |

---

## 插件清单格式

`plugin.json` 文件定义插件元数据：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "插件描述",
  "main": "index.ts",
  "author": "作者",
  "license": "MIT",
  "keywords": ["tag1", "tag2"],
  "tags": ["category"],
  "dependencies": {
    "other-plugin": "^1.0.0"
  },
  "adapterDependencies": ["xiaoyi"],
  "config": {
    "apiKey": {
      "type": "string",
      "description": "API 密钥",
      "required": true
    },
    "timeout": {
      "type": "number",
      "description": "超时时间（毫秒）",
      "default": 30000,
      "min": 5000,
      "max": 120000
    },
    "region": {
      "type": "string",
      "description": "服务区域",
      "enum": ["us-east-1", "eu-west-1", "ap-northeast-1"]
    }
  },
  "defaultConfig": {
    "timeout": 30000
  }
}
```

---

## 配置字段类型

| 类型 | 描述 | 验证选项 |
|------|------|----------|
| `string` | 字符串 | `pattern`, `enum` |
| `number` | 数字 | `min`, `max` |
| `boolean` | 布尔值 | - |
| `array` | 数组 | - |
| `object` | 对象 | - |

---

## 生命周期钩子

插件支持以下生命周期钩子：

| 钩子 | 触发时机 |
|------|----------|
| `install` | 首次安装 |
| `uninstall` | 卸载时 |
| `enable` | 启用时 |
| `disable` | 禁用时 |
| `onConfigChange` | 配置变更时 |

---

## 错误码

| 状态码 | 描述 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 404 | 插件未找到 |
| 500 | 服务器内部错误 |

---

## 示例

### 完整安装流程

```bash
# 1. 发现插件
curl -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/plugins/discover

# 2. 安装插件
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "xiaoyi", "config": {"ak": "xxx", "sk": "xxx"}}' \
  https://api.example.com/api/plugins

# 3. 验证配置
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"config": {"timeout": 60000}}' \
  https://api.example.com/api/plugins/xiaoyi/validate

# 4. 启用插件
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/plugins/xiaoyi/enable

# 5. 检查状态
curl -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/plugins/xiaoyi
```

### 更新配置

```bash
# 获取当前配置
curl -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/plugins/xiaoyi/config

# 更新配置
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"config": {"timeout": 60000}}' \
  https://api.example.com/api/plugins/xiaoyi/config
```

---

*最后更新: 2026-03-22*
