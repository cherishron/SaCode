// 提示词增强：图标只有「增强」与「回退」两副面孔，判据是「上一次替换还完整地留在输入框里」。
// 用户一改就作废——哪怕改回一模一样的字也算作废，因为从那一刻起「该不该覆盖」已经不由我们决定了。
// 经典脚本（CSP script-src 'self'）。

(function (root) {
  'use strict';

  function createEnhanceAssembly({ ref, draft, getDraftRevision, getSessionGeneration, error, catalogError, updateDraft, focusComposerCaret }) {
    const enhance = ref({ busy: false, undo: false });
    let enhanceSeq = 0, enhanceTimer = null, enhanceUndo = null, enhanceFrozen = null;

    function stopEnhancePoll() { if (enhanceTimer) { clearTimeout(enhanceTimer); enhanceTimer = null; } }
    function clearEnhance() { stopEnhancePoll(); enhanceFrozen = null; enhanceUndo = null; enhance.value = { busy: false, undo: false }; }

    function userEditDraft(value) {
      if (enhance.value.undo) { enhanceUndo = null; enhance.value = { busy: false, undo: false }; }
      updateDraft(value);
    }

    function enhanceNotice(failure, result) {
      const raw = failure ? String(failure.message || failure) : String((result && result.error) || "");
      // 顺序即优先级：具体原因排在笼统形态之前。传输层失败带稳定原因后缀
      // （core/src/transport_failure.cj 的 transportReason），命中更细的那一条。
      const reasons = {
        "tls-certificate-expired": "连接时收到的证书被判为过期，草稿已保留。请检查系统时间与 API 地址；这不等于目标服务的证书一定过期。",
        "tls-certificate-rejected": "连接时证书验证未通过，草稿已保留。请检查系统时间、API 地址及证书配置，不要关闭证书校验。",
        "tls-alpn-unsupported": "HTTPS 应用协议协商失败，草稿已保留。请检查客户端协议配置。",
        "tls-anchor-missing": "本机信任根里没有这家模型服务的证书颁发机构，请求在 TLS 校验阶段就被拒，草稿已保留。请先更新 Windows 根证书或换一家已被信任的供应商。",
        "tls-handshake-rejected": "HTTPS 握手未完成，草稿已保留。请检查 API 地址及客户端 TLS 配置；请求尚未进入密钥认证阶段。",
        "dns-failed": "解析不到这家模型服务的域名，草稿已保留。请检查 API 地址是否写错。",
        "connection-refused": "连接被拒绝，地址或端口不通，草稿已保留。请检查 API 地址。",
        "connection-reset": "连接被中途断开，草稿已保留。",
        "model-not-configured": "还没有选择模型，请先在模型中心配好再增强。",
        "model-credential-unavailable": "当前模型的密钥没有配好，增强没有发出。",
        "protocol-not-supported": "当前模型的说法暂不支持增强，草稿已保留。",
        "enhance-empty-result": "模型没有给出可用的改写，草稿保持原样。",
        "enhance-max-tokens": "改写被截断了，半截话不能替换你的草稿。",
        "enhance-unexpected-tool": "模型试图执行操作，这次增强已作废，草稿保持原样。",
        "provider-init-failed": "连不上模型，草稿已保留，可以再试一次。",
        "http-request-error": "连不上模型，草稿已保留，可以再试一次。",
        "http-status": "模型拒绝了这次请求（常见于密钥或模型名不对），草稿已保留。",
        "timeout": "模型响应超时，草稿已保留，可以再试一次。",
        "enhance-in-flight": "上一条增强还在进行，请先取消它。",
      };
      return Object.entries(reasons).find(([key]) => raw.includes(key))?.[1] || catalogError(failure || new Error(raw));
    }

    function finishEnhance(frozen, result, failure) {
      if (enhanceFrozen !== frozen) { return; }
      enhanceFrozen = null;
      const text = result && typeof result.text === "string" ? result.text : "";
      const usable = !failure && result && result.settled !== false && result.ok && !result.cancelled && text.trim().length > 0;
      if (!usable) {
        enhance.value = { busy: false, undo: false };
        if (!(result && result.cancelled)) { error.value = enhanceNotice(failure, result); }
        return;
      }
      if (getDraftRevision() !== frozen.revision || getSessionGeneration() !== frozen.generation) {
        enhance.value = { busy: false, undo: false };
        return;
      }
      if (!window.SaCodeComposerEdit.replace(document.getElementById("composer"),text)) {
        enhance.value={busy:false,undo:false};error.value="输入框无法建立撤销记录，草稿已保留。";return;
      }
      enhanceUndo = { text: frozen.original };
      enhance.value = { busy: false, undo: true };
      error.value = "";
      focusComposerCaret();
    }

    function pollEnhance(frozen, startTime) {
      const elapsed = Date.now() - (startTime || Date.now());
      if (elapsed > 120000) {
        void window.sacode.promptCancel().catch(() => {});
        finishEnhance(frozen, null, new Error("提示词增强超时"));
        return;
      }
      enhanceTimer = setTimeout(async () => {
        enhanceTimer = null;
        if (enhanceFrozen !== frozen) { return; }
        let result = null;
        try { result = await window.sacode.promptPoll(); }
        catch (e) { finishEnhance(frozen, null, e); return; }
        if (enhanceFrozen !== frozen) { return; }
        if (!result || !result.settled) { pollEnhance(frozen, startTime); return; }
        finishEnhance(frozen, result, null);
      }, 120);
    }

    async function startEnhance() {
      const original = draft.value;
      if (!original.trim() || enhance.value.busy) { return; }
      const frozen = { seq: ++enhanceSeq, revision: getDraftRevision(), generation: getSessionGeneration(), original };
      enhanceUndo = null;
      enhanceFrozen = frozen;
      enhance.value = { busy: true, undo: false };
      error.value = "";
      try { await window.sacode.promptEnhance(original); }
      catch (e) { finishEnhance(frozen, null, e); return; }
      if (enhanceFrozen === frozen) { pollEnhance(frozen, Date.now()); }
    }

    async function cancelEnhance() {
      const frozen = enhanceFrozen;
      if (!frozen) { return; }
      enhanceFrozen = null;
      stopEnhancePoll();
      enhance.value = { busy: false, undo: false };
      try { await window.sacode.promptCancel(); } catch (_) {}
    }

    function undoEnhance() {
      if (!enhance.value.undo || !enhanceUndo) { return; }
      const original = enhanceUndo.text;
      enhanceUndo = null;
      enhance.value = { busy: false, undo: false };
      if (!window.SaCodeComposerEdit.undo(document.getElementById("composer"),original)) updateDraft(original);
      focusComposerCaret();
    }

    function clickEnhance() {
      if (enhance.value.busy) { cancelEnhance(); }
      else if (enhance.value.undo) { undoEnhance(); }
      else { startEnhance(); }
    }

    return {
      enhance, enhanceUndo, enhanceFrozen,
      stopEnhancePoll, clearEnhance, userEditDraft, enhanceNotice,
      finishEnhance, pollEnhance, startEnhance, cancelEnhance, undoEnhance, clickEnhance
    };
  }

  root.SaCodeEnhance = { createEnhanceAssembly };
})(globalThis);
