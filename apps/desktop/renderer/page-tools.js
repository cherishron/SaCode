// 页面工具注册模块：把固定页面工具集注册进 document.modelContext，
// 让模型能像调用 write/read 一样调用页面工具（读 DOM、点击、输入、滚动）。
// 运行时无模块加载器、无 eval，纯经典脚本，挂 window.DshPageTools。

(function() {
  'use strict';

  const tools = [];

  // 注册页面工具
  function register(name, description, parameters, handler) {
    tools.push({ name, description, parameters, handler });
    // 同步到 document.modelContext
    if (document && document.modelContext) {
      try {
        document.modelContext.registerTool({ name, description, parameters, handler });
      } catch (e) {
        // modelContext 未初始化时忽略
      }
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
        return { name: t.name, description: t.description, parameters: t.parameters };
      });
    }
  };

  // 当 Next SDK 初始化完成后，同步注册到 modelContext
  function syncToModelContext() {
    if (document && document.modelContext) {
      for (const tool of tools) {
        try {
          document.modelContext.registerTool({ name: tool.name, description: tool.description, parameters: tool.parameters, handler: tool.handler });
        } catch (e) {
          // 忽略
        }
      }
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
