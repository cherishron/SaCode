(function (root) {
  'use strict';

  function catalogError(e) {
    const message = String(e.message || e);
    const reasons = {
      'selection-replay-rejected': '所选会话无法读取，请从会话列表选择可用会话。',
      'selection-failed-restart-required': '会话选择保存失败，请重启后继续。',
      'workspace-flush-failed': '项目目录保存失败，请重启后检查会话日志。',
      'workspace-failed-restart-required': '项目目录保存失败，请重启后继续。',
      'workspace-session-changed': '选择目录期间会话已切换，未修改新的会话，请重新选择项目。',
      'unknown-recent-workspace': '该最近项目已不在清单中，请直接打开文件夹。',
      'workspace-not-configured': '请先选择项目文件夹；程序运行目录不会自动作为项目。',
      'bad-workspace-directory': '请选择存在的项目文件夹。',
      'session-resources-in-flight': '请先处理审批工单并关闭在途扩展。',
      'turn-in-flight': '请先停止当前执行并等待结算。',
      'already-owned': '会话正在由另一写者使用，请稍后重试。',
      'session-owner-unknown': '无法确认会话写锁的归属，已保留当前会话；请检查其他窗口或存储权限。',
      'session-storage-unavailable': '会话目录无法创建或写入，已保留当前会话和草稿；请检查存储路径及访问权限。',
      'bad-session-title': '请输入有效的会话名称。',
      'replay-rejected': '会话日志无法回放，已保留原会话。',
      'unknown-session': '会话目录不存在，请刷新列表。',
      'selection-flush-failed': '会话选择保存失败，请重启后检查日志。',
      'flush-failed': '当前会话保存失败，尚未切换。',
      'attachment-receipt-unknown': '附件凭证已失效，请重新上传。',
      'attachment-media-type-mismatch': '附件内容与所选类型不符。',
      'attachment-unsupported-media-type': '图片暂时只支持 PNG、JPEG、GIF。',
      'attachment-bad-base64': '附件读取失败，请重试。',
      'attachment-image-too-large': '单张图片不能超过 20 MB。',
      'attachment-image-count-exceeded': '一条消息最多 20 张图片。',
      'attachment-image-bytes-exceeded': '一条消息的图片合计不能超过 200 MB。',
      'attachment-image-pixels-exceeded': '图片像素超过 6400 万。',
      'attachment-image-dimension-exceeded': '图片单边不能超过 8192 像素。',
      'attachment-corrupt-object': '附件内容校验不通过，请重新上传。',
      'attachment-missing-object': '附件对象已不在盘上，请重新上传。',
    };
    return Object.entries(reasons).find(([key]) => message.includes(key))?.[1] || message;
  }

  root.SaCodeSessionCatalog = { catalogError };
})(globalThis);
