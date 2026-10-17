// 页面工具注册模块：把固定页面工具集注册进 document.modelContext，
// 让模型能像调用 write/read 一样调用页面工具（读 DOM、点击、输入、滚动）。
// 运行时无模块加载器、无 eval，纯经典脚本，挂 window.DshPageTools。

(function() {
  'use strict';

  const tools = [];

  // 注册页面工具
  function register(name, description, parameters, handler) {
    const tool = { name, description, parameters, handler, registered: false, error: '' };
    tools.push(tool);
    publishToModelContext(tool);
    return tool;
  }

  // WebMCP 校验器只认 inputSchema 与 execute：交 parameters+handler 会被静默丢键，再因 execute 不是函数而抛。
  // execute 回主进程 pageToolCall 那一道，与另一条页面工具入口共用同一次校验；挂不上就记状态，不再吞成「还没初始化」。
  function publishToModelContext(tool) {
    if (!document || !document.modelContext) return;
    try {
      document.modelContext.registerTool({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
        execute: function (args) {
          if (!window.sacode || typeof window.sacode.pageToolCall !== 'function') {
            return Promise.resolve({ error: 'page-tools-unavailable' });
          }
          return window.sacode.pageToolCall(tool.name, args || {});
        },
      });
      tool.registered = true;
      tool.error = '';
    } catch (e) {
      tool.registered = false;
      tool.error = (e && e.message) || String(e);
    }
  }

  // 页面工具集
  register('page.readState', '读取页面当前状态（DOM 文本、选择器等）', {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS 选择器，可选' }
    }
  }, async function(args) {
    const sel = args && args.selector;
    if (sel) {
      const el = document.querySelector(sel);
      return el ? { text: el.innerText || el.textContent, tag: el.tagName } : { error: 'not-found' };
    }
    return { text: document.body.innerText, url: document.URL };
  });

  register('page.clickElement', '点击页面元素', {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS 选择器' },
      selectorType: { type: 'string', enum: ['css', 'text', 'role'], description: '选择器类型' }
    },
    required: ['selector']
  }, async function(args) {
    const el = findElement(args.selector, args.selectorType || 'css');
    if (!el) return { error: 'not-found', selector: args.selector };
    el.click();
    return { ok: true };
  });

  register('page.inputText', '在页面元素中输入文本', {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS 选择器' },
      text: { type: 'string', description: '要输入的文本' }
    },
    required: ['selector', 'text']
  }, async function(args) {
    const el = findElement(args.selector, 'css');
    if (!el) return { error: 'not-found', selector: args.selector };
    el.focus();
    el.value = args.text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  });

  register('page.scroll', '滚动页面', {
    type: 'object',
    properties: {
      x: { type: 'number', description: '水平滚动像素' },
      y: { type: 'number', description: '垂直滚动像素' }
    }
  }, async function(args) {
    window.scrollBy(args.x || 0, args.y || 0);
    return { ok: true };
  });

  // 辅助：根据类型查找元素
  function findElement(selector, type) {
    if (type === 'text') {
      // 按文本查找
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.includes(selector)) {
          return walker.currentNode.parentElement;
        }
      }
      return null;
    }
    if (type === 'role') {
      return document.querySelector(`[role="${selector}"]`);
    }
    return document.querySelector(selector);
  }

  // 公开 API
  window.DshPageTools = {
    register,
    get tools() { return tools; },
    list: function() {
      return tools.map(function(t) {
        // registered/error 是给上游那一眼看的真话：本地有条目不等于模型侧收得到
        return { name: t.name, description: t.description, parameters: t.parameters, registered: t.registered, error: t.error };
      });
    }
  };

  // 当 Next SDK 初始化完成后，同步注册到 modelContext
  function syncToModelContext() {
    if (document && document.modelContext) {
      for (const tool of tools) publishToModelContext(tool);
    }
  }

  // 轮询等待 modelContext 就绪
  var syncTimer = setInterval(function() {
    if (document && document.modelContext) {
      syncToModelContext();
      clearInterval(syncTimer);
    }
  }, 100);
  setTimeout(function() { clearInterval(syncTimer); }, 10000); // 10 秒超时
})();
