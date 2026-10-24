# Web 部署拓扑与多实例演进（2026-10-24）

> 类别：②设计文档 / ④实施计划。上级索引：[docs/README.md](../../README.md)｜方案索引：[plans/README.md](../../plans/README.md)
> 关联证据：[`../evidence/2026-10-23-web-w01-w02a-poc.md`](2026-10-23-web-w01-w02a-poc.md) §8（部署干跑）
> 日期：2026-10-24。状态：方向已与用户确认；未实施、未部署。

## 1. 部署单元（用户 2026-10-24 确认）

`apps/web` 是**前后端一体的部署单元**：构建后由**一个 Node 进程**同时提供前端 SPA（`dist/client`）与后端 BFF（`/api`），服务器上部署这一个包即可。

- 构建：`npm run build`（`vite build` → `dist/client`；`tsc -p tsconfig.json` → `dist/server/server/`）
- 启动：`npm start` → `node dist/server/server/index.js`
- 绑定：仅回环（`SACODE_WEB_BIND=127.0.0.1`）；非回环在配置层直接抛错、不降级

## 2. 正式拓扑（首版目标）

```text
浏览器（域名 + HTTPS）
   ↓
nginx（SSL 终止 / 反向代理）
   ↓ 127.0.0.1:18787
Web 单进程（SPA + BFF）
   ↓ 受保护内部连接
daemon（真实会话与执行）
```

**分工**
- **nginx**：SSL 证书、HTTPS、反向代理；对外只开放入口，Web 端口不直接暴露公网。
- **Web**：登录、鉴权、页面与 API、事件 broker；只监听回环。
- **daemon**：可与 Web 同机部署，不直接暴露公网。

**nginx 侧必须显式配置的两项**（否则 SSE 会被缓冲成一次性输出）
- `proxy_buffering off`
- 合理的读超时（长连接不被提前断开）

## 3. 为什么不让 Web 自己绑 SSL（用户 2026-10-24 确认）

- 证书与 TLS 终止交给 nginx 更方便；
- Web 进程不直接承载公网 TLS 与负载均衡等职责，缩小暴露面。

## 4. 多实例 / 负载均衡的演进前提（关键约束）

**nginx 能配置负载均衡，不等于当前 Web 已支持多实例。**当前 BFF 有三处状态在进程内存：

| 状态 | 现状 | 多实例前的处理 |
|---|---|---|
| 登录会话 | `SessionStore` 在进程内存 | 外置到共享存储（如 Redis），或 nginx 按用户做会话粘滞 |
| 事件订阅 | 每 target 单条上游订阅在各自进程 | 共享事件通道分发（如 Redis 发布订阅），或固定单实例持有订阅再广播 |
| 任务归属 | 依赖具体 Web 实例 | 归属信息放共享存储，按用户/会话路由 |

## 5. 路径选择

- **A（首版，推荐）**：nginx + 单实例 Web + daemon。简单稳定；风险是 Web 进程故障即服务中断。
- **B（后续增强）**：共享会话存储 + 共享事件通道 + 明确任务路由 + nginx 负载均衡。需在 BFF 增加状态外置层，不属于当前 PoC 范围。

**决定：先按 A 部署；待单实例跑稳、真实 daemon 接通后，再评估是否演进到 B。**

## 6. 与 W04 的关系

本文档固化部署拓扑与多实例前提；W04（可追溯包、TLS 代理配置、秘密管理、服务监督、配额、监控、停机升级回退文档）仍按 `2026-10-23-web-workbench-architecture.md` §11 的出口要求独立验收。

## 6.5 nginx 配置模板（W04 可直接使用）

> 状态：**模板未经实机验证**（本机无 nginx）。上线前须在目标服务器 `nginx -t` 并实际访问验证，尤其是 SSE。

```nginx
# /etc/nginx/conf.d/sacode-web.conf
# Web 只监听回环；对外入口由本文件提供
upstream sacode_web {
    server 127.0.0.1:18787;
    keepalive 32;
    # 多实例前先满足 §4 三前提；否则不要在这里加第二个 server
}

server {
    listen 80;
    server_name code.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name code.example.com;

    ssl_certificate     /etc/letsencrypt/live/code.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/code.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # 与 BFF bodyLimit 对齐（server/index.ts 为 256KiB）
    client_max_body_size 256k;

    # 常规页面与 API
    location / {
        proxy_pass http://sacode_web;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 事件流（SSE）——关键：必须关闭缓冲，否则事件会攒到最后一次性输出
    location ~ ^/api/targets/[^/]+/sessions/[^/]+/stream$ {
        proxy_pass http://sacode_web;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering    off;   # 不缓冲，保证流式到达
        proxy_cache        off;
        chunked_transfer_encoding off;

        # 长连接：SSE 心跳 15s，故读超时须远大于它
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
    }
}
```

**必须逐项核对的点**

| 项 | 说明 |
|---|---|
| `proxy_buffering off` | 不设则 SSE 被缓冲，浏览器收不到增量事件（首字节也出不去）。这是最易踩的一条 |
| `proxy_read_timeout` | 必须大于 SSE 心跳间隔（15s），否则长连接被提前切断 |
| `client_max_body_size` | 与 BFF 请求体上限 256KiB 对齐，避免两侧不一致 |
| `upstream` 单节点 | 首版按路径 A（单实例）；加第二节点前须先完成 §4 三前提 |
| 证书路径 | 替换为实际证书（示例为 Let's Encrypt） |
| 同源 | 页面与 `/api` 同域，满足 cookie/CSRF/Origin 设计；不要拆成两个域名 |

## 7. 未验证 / 边界

- 真实 HTTPS 与 nginx 配置**未**在服务器上执行验证（干跑用的是自写最小反代，仅验证拓扑）。
- 多实例相关能力（共享会话、共享事件通道、任务路由）**均未实现**，仅为演进前提记录。
- 真实 daemon 仍受 P0-3/P0-4/web-consumer 三道闸门约束，未接通。
