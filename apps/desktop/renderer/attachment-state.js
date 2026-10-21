(function (root) {
  'use strict';

  function createAttachmentState({ ref, upload, getGeneration, error, formatError }) {
    const attachments = ref([]), uploads = ref({});
    let attSeq = 0;
    const imageMime = ['image/png', 'image/jpeg', 'image/gif'];
    const kindOf = file => imageMime.includes(file.type) ? 'image' : 'file';

    function readAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result || '');
          const comma = text.indexOf(',');
          if (comma < 0) reject(new Error('附件读取失败'));
          else resolve(text.slice(comma + 1));
        };
        reader.onerror = () => reject(new Error('附件读取失败'));
        reader.readAsDataURL(file);
      });
    }

    async function uploadAttachment(item, file) {
      const generation = getGeneration();
      try {
        const data = await readAsBase64(file);
        const kind = kindOf(file);
        const out = await upload(kind, file.name || '', kind === 'image' ? file.type : '', data);
        if (generation !== getGeneration()) return;
        item.receiptId = out.receiptId;
        item.attachment = out.attachment;
        if (kind === 'image' && !item.previewUrl) item.previewUrl = URL.createObjectURL(file);
        uploads.value = { ...uploads.value, [item.id]: { status: 'ready' } };
      } catch (e) {
        if (generation !== getGeneration()) return;
        uploads.value = { ...uploads.value, [item.id]: { status: 'error', message: formatError(e) } };
        error.value = formatError(e);
      }
    }

    function addAttachments(files, directories) {
      for (const file of files) {
        const item = { id: 'a' + (++attSeq), kind: kindOf(file), file, previewUrl: '' };
        attachments.value = [...attachments.value, item];
        uploads.value = { ...uploads.value, [item.id]: { status: 'uploading' } };
        void uploadAttachment(item, file);
      }
      if (directories && directories.length) {
        error.value = '只接受文件，文件夹不入库：' + directories.map(d => d.name).join('、');
      }
    }

    function removeAttachment(id) {
      const gone = attachments.value.find(a => a.id === id);
      if (gone && gone.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      attachments.value = attachments.value.filter(a => a.id !== id);
      const rest = { ...uploads.value };
      delete rest[id];
      uploads.value = rest;
    }

    function retryAttachment(id) {
      const item = attachments.value.find(a => a.id === id);
      if (!item) return;
      uploads.value = { ...uploads.value, [id]: { status: 'uploading' } };
      void uploadAttachment(item, item.file);
    }

    function clearAttachments() {
      for (const item of attachments.value) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      attachments.value = [];
      uploads.value = {};
    }

    return { attachments, uploads, addAttachments, removeAttachment, retryAttachment, clearAttachments };
  }

  // 当前文件引用由 composer 写成独立的「工作区文件：路径」行；不扫描普通正文或工具 @ 引用。
  function workspaceReferences(text) {
    return [...new Set(String(text).split(/\r?\n/).filter(line => line.startsWith('工作区文件：'))
      .map(line => line.slice('工作区文件：'.length)).filter(path => path && !path.startsWith('@')))];
  }

  function createReferenceSendGuard({ getText, getIdentity, listFiles, confirm, submit, replaceText, error }) {
    let busy = false;
    return async function send(...args) {
      if (busy) { error('正在检查引用或等待确认，请稍后。'); return; }
      const text = getText(), identity = getIdentity();
      const current = () => text === getText() && identity === getIdentity();
      const paths = workspaceReferences(text);
      if (!paths.length) return submit(...args);
      busy = true;
      try {
        const missing = [], directories = new Map();
        for (const path of paths) {
          const normalized = path.replace(/\\/g, '/'), at = normalized.lastIndexOf('/');
          const parent = at < 0 ? '' : normalized.slice(0, at), name = normalized.slice(at + 1);
          // 非工作区相对路径不提交给宿主；让用户明确移除后再发送。
          if (!name || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some(p => p === '..' || p === '.')) {
            missing.push(path); continue;
          }
          let directory = '', absentParent = false;
          for (const segment of (parent ? parent.split('/') : []).concat([null])) {
            if (!directories.has(directory)) directories.set(directory, await listFiles(directory));
            if (!current()) { error('草稿或会话已变化，请重新发送以检查引用。'); return; }
            const view = directories.get(directory);
            if (!view || !Array.isArray(view.files) || view.error || view.configured === false) throw Error('目录回执无效');
            const found = view.files.some(file => file.name === (segment === null ? name : segment) && file.isDir === (segment !== null));
            // 旧 Host 最多列200项且无截断标记，未列出不能当成已删除。
            if (!found && view.files.length >= 200) throw Error('目录列表可能截断');
            if (segment === null) {
              if (!found) missing.push(path);
            } else {
              if (!found) { absentParent = true; break; }
              directory = directory ? directory + '/' + segment : segment;
            }
          }
          if (absentParent) missing.push(path);
        }
        if (!current()) return;
        if (missing.length && !await confirm(missing)) return;
        if (!current()) { error('草稿或会话已变化，请重新发送以检查引用。'); return; }
        const rejected = new Set(missing);
        const cleaned = text.split(/\r?\n/).filter(line => !line.startsWith('工作区文件：') || !rejected.has(line.slice('工作区文件：'.length))).join('\n');
        if (!cleaned.trim()) { error('移除失效引用后消息为空，请补充内容后再发送。'); return; }
        if (missing.length) replaceText(cleaned);
        const submittedIdentity = getIdentity();
        try { await submit(...args); }
        finally {
          // 底层拒绝/失败未清草稿时，还原原始引用，便于用户修正或重试。
          if (missing.length && getText() === cleaned && submittedIdentity === getIdentity()) replaceText(text);
        }
      } catch (_) {
        if (current()) error('无法检查工作区引用，消息未发送。请确认项目和目录可读取后重试。');
      } finally { busy = false; }
    };
  }

  root.SaCodeAttachmentState = { createAttachmentState, workspaceReferences, createReferenceSendGuard };
})(globalThis);
