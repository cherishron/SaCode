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

  root.SaCodeAttachmentState = { createAttachmentState };
})(globalThis);
