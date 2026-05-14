---
name: "Add WeChat"
---

# Add WeChat Skill

帮助用户配置微信机器人连接。

## 触发条件

- 用户想要连接微信
- 用户询问如何添加微信机器人
- 用户需要微信消息通知

## 使用指南

### 1. 了解微信机器人方案

微信机器人有多种实现方案：

| 方案 | 说明 | 推荐度 |
|------|------|--------|
| Web 微信 | 扫码登录，已受限 | ⭐ 低 |
| ComWechat | 企业微信接口 | ⭐⭐ 中 |
| Wechaty | 多协议支持 | ⭐⭐⭐ 高 |

### 2. 推荐方案：ComWechat

ComWechat 是基于企业微信的方案，稳定性较高。

#### 配置步骤：

1. 注册企业微信账号
2. 创建应用并获取凭证
3. 配置回调 URL

### 3. 配置 SACODE

在 `.env` 文件中添加：

```env
WECHAT_CORP_ID=your_corp_id
WECHAT_AGENT_ID=your_agent_id
WECHAT_SECRET=your_secret
```

### 4. 启动连接

```bash
# 使用 CLI
sacode im connect wechat

# 或通过 API
POST /api/im/connect
{
  "platform": "wechat",
  "config": {
    "corpId": "your_corp_id",
    "agentId": "your_agent_id",
    "secret": "your_secret"
  }
}
```

## 可用工具

- `im.connect` - 连接 IM 平台
- `im.send` - 发送消息
- `im.list` - 列出连接

## 注意事项

- 企业微信需要在企业微信后台配置可信域名
- 消息发送有频率限制
- 敏感操作需要管理员审批
- 账号安全非常重要，请妥善保管凭证

## 相关链接

- [企业微信开发文档](https://developer.work.weixin.qq.com/document/)
- [ComWechat 项目](https://github.com/littlecodersh/ItChat)
