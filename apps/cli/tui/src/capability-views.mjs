// 只消费已声明的查询面；不连接MCP、不调用工具、不改变权限/计划。
export function requireCapability(capabilities, method) {
  if (!capabilities.has(method)) throw new Error(`当前宿主未声明 ${method}，此入口不可用；不会回退执行其他动作`);
}

export async function skillOptions(client, capabilities) {
  requireCapability(capabilities, 'skill/list');
  const reply = await client.request('skill/list', {}, 15000);
  if (!Array.isArray(reply) || reply.some((item) => !item || typeof item.name !== 'string' || typeof item.description !== 'string')) throw new Error('技能目录响应格式无效');
  return reply.map((item) => ({ id: item.name, label: `${item.name} · ${item.description}`, skill: item }));
}

export async function skillDetail(client, capabilities, name) {
  requireCapability(capabilities, 'skill/get');
  const reply = await client.request('skill/get', { name }, 15000);
  if (reply?.name !== name || typeof reply.content !== 'string') throw new Error('技能详情身份或正文无效');
  return { title: `技能 · ${name}（只读）`, text: `说明：${reply.description || ''}\n适用：${reply.whenToUse || '宿主未提供'}\n\n仅浏览正文，不自动执行或注入模型上下文。`, markdown: reply.content };
}

export async function mcpOptions(client, capabilities, sessionId) {
  requireCapability(capabilities, 'mcp/list');
  const reply = await client.request('mcp/list', { sessionId }, 15000);
  if (!Array.isArray(reply?.servers) || reply.servers.some((name) => typeof name !== 'string')) throw new Error('MCP目录响应格式无效');
  return reply.servers.map((name) => ({ id: name, label: `${name} · 已注册，连接状态待查询` }));
}

export async function mcpDetail(client, capabilities, sessionId, name) {
  requireCapability(capabilities, 'mcp/status');
  const reply = await client.request('mcp/status', { sessionId, name }, 15000);
  if (typeof reply?.connected !== 'boolean') throw new Error('MCP连接状态未确认');
  return { title: `MCP · ${name}`, text: `注册：已注册\n连接：${reply.connected ? '已连接' : '未连接'}\n\n仅显示当前宿主进程的连接事实，不代表服务可用或工具已授权。\n未发送 tools/list、探测、connect 或工具调用。连接、调用与配置入口仍待接入。` };
}

export async function modeDetail(client, capabilities, kind) {
  const method = kind === 'permissions' ? 'approval/get-mode' : 'plan/get-mode';
  requireCapability(capabilities, method);
  const reply = await client.request(method, {}, 15000);
  if (reply?.ok !== true) throw new Error('模式状态未确认');
  if (kind === 'permissions') {
    if (!['plan', 'build', 'auto', 'yolo'].includes(reply.mode)) throw new Error('未知权限档位，不推断安全状态');
    return { title: '权限状态（只读）', text: `宿主当前档位：${reply.mode}\n\n档位并不证明OS沙箱已启用，也不保证每个工具都已授权。\n此入口不切换模式、不放宽权限；审批仍按宿主当前策略执行。` };
  }
  if (typeof reply.active !== 'boolean') throw new Error('计划模式状态无效');
  return { title: '计划模式（只读）', text: `宿主计划模式：${reply.active ? '已进入' : '未进入'}\n\n此处没有进入/退出操作，不把查看状态当作计划已提交或获批。` };
}
