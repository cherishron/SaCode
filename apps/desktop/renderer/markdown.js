// Markdown 只派生视图，token 转 Vue 节点；不执行 HTML、不加载远程图片。
"use strict";
window.SaCodeMarkdown = (function () {
  const parser = new window.SaCodeMarkdownIt({ html: false, linkify: false, breaks: false });
  const tags = new Set(['p','h1','h2','h3','h4','h5','h6','blockquote','ul','ol','li','strong','em','s','a','table','thead','tbody','tr','th','td']);
  function nodes(tokens) {
    const root = [], stack = [{ children: root }];
    const add = (node) => stack[stack.length - 1].children.push(node);
    for (const token of tokens) {
      if (token.nesting === -1) {
        if (stack.length > 1) {
          const frame = stack.pop();
          add(window.Vue.h(frame.tag, frame.props, frame.children));
        }
      } else if (token.nesting === 1) {
        const tag = tags.has(token.tag) ? token.tag : 'span';
        const props = {};
        if (tag === 'a') {
          const href = token.attrGet('href') || '';
          if (/^(https?:|mailto:)/i.test(href)) props.href = href;
          const title = token.attrGet('title');
          if (title) props.title = title;
        }
        if (tag === 'ol' && token.attrGet('start')) props.start = token.attrGet('start');
        stack.push({ tag, props, children: [] });
      } else if (token.type === 'inline') {
        nodes(token.children || []).forEach(add);
      } else if (token.type === 'fence' || token.type === 'code_block') {
        add(window.Vue.h('pre', {}, [window.Vue.h('code', {}, token.content)]));
      } else if (token.type === 'code_inline') {
        add(window.Vue.h('code', {}, token.content));
      } else if (token.type === 'hardbreak') {
        add(window.Vue.h('br'));
      } else if (token.type === 'softbreak') {
        add('\n');
      } else if (token.type === 'hr') {
        add(window.Vue.h('hr'));
      } else if (token.type === 'image') {
        // 图片地址不可触发网络请求；保留替代文字，附件通道另行接入。
        add(window.Vue.h('span', { class: 'markdown-image-alt' }, token.content || '图片'));
      } else {
        add(token.content || '');
      }
    }
    return root;
  }
  const render = (text) => nodes(parser.parse(text, {}));
  // 流式与投影消息共享同一正文组件，格式变化不另造会话状态。
  const Body = {
    props: { text: { type: String, default: '' } },
    setup: (props) => () => window.Vue.h('div', { class: 'msg-text markdown-body' }, render(props.text)),
  };
  const Stream = {
    props: { text: { type: String, default: '' }, running: { type: Boolean, default: false } },
    setup: (props) => () => window.Vue.h('div', { id: 'stream', class: 'streaming' }, [
      window.Vue.h('span', { class: 'msg-role' }, '助手 · 流式输出'),
      props.text ? window.Vue.h('div', { class: 'stream-content' }, [window.Vue.h(Body, { text: props.text })]) : null,
      props.running ? window.Vue.h('span', { class: 'note stream-status', role: 'status' }, '流式中…') : null,
    ]),
  };
  return { render, Body, Stream };
})();
