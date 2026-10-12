// 上游能力是明确声明，不是从模型名或 GET /models 推断；两处提供商编辑器共用同一字段面。
import { h } from 'vue';

export interface ModelCapabilities {
  inputModalities?: string[];
  outputModalities?: string[];
  supports?: string[];
  meterUnit?: string;
  provenance?: string;
  availability?: 'available' | 'unsupported' | 'unknown';
}
export function cloneModel<T extends ModelCapabilities>(model: T): T {
  return { ...model, inputModalities: [...(model.inputModalities || [])],
    outputModalities: [...(model.outputModalities || [])], supports: [...(model.supports || [])] };
}
export function modelCapabilitySummary(model: ModelCapabilities): string {
  const state = ({ available: '已声明可用', unsupported: '不支持', unknown: '能力未确认' })[model.availability || 'unknown'];
  const origin = model.provenance === 'human-confirmed' ? '用户确认（非自动验证）'
    : model.provenance === 'provider-listed' ? '来自模型目录（非生成验证）' : '尚无确认记录';
  return `${state} · ${origin}`;
}
export function renderModelCapabilities(model: ModelCapabilities & { image: boolean }, index: number, disabled: boolean, changed: () => void) {
  const prefix = `模型 ${index + 1} `;
  const mark = () => { model.provenance = 'human-confirmed'; changed(); };
  const checkbox = (label: string, field: 'inputModalities' | 'outputModalities' | 'supports', value: string) => h('label', { class: 'model-capability-check' }, [
    h('input', { type: 'checkbox', checked: (model[field] || (field === 'inputModalities' && model.image ? ['image'] : [])).includes(value), disabled,
      'aria-label': prefix + label, onChange: (event: Event) => {
        const on = (event.target as HTMLInputElement).checked;
        const values = model[field] || (field === 'inputModalities' && model.image ? ['image'] : []);
        model[field] = on ? [...new Set([...values, value])] : values.filter(v => v !== value);
        if (field === 'inputModalities' && value === 'image') model.image = on;
        mark();
      } }), label,
  ]);
  return h('fieldset', { class: 'model-capabilities', disabled }, [
    h('legend', '上游模型能力声明'),
    h('p', { class: 'note' }, '仅按服务商文档或你的实际使用结果填写。获取模型名称不证明能力；这些选项不代表程序已经测试成功。'),
    h('p', { class: 'note', role: 'status' }, modelCapabilitySummary(model)),
    h('label', { class: 'model-capability-state' }, [
      '可用状态', h('select', { value: model.availability || 'unknown', disabled, 'aria-label': prefix + '可用状态',
        onChange: (event: Event) => { model.availability = (event.target as HTMLSelectElement).value as ModelCapabilities['availability']; mark(); } }, [
        h('option', { value: 'unknown' }, '未知（尚未确认）'),
        h('option', { value: 'available' }, '我确认该模型可用'),
        h('option', { value: 'unsupported' }, '不支持／不可用'),
      ]),
    ]),
    h('div', { class: 'model-capability-options' }, [
      checkbox('文本输入', 'inputModalities', 'text'), checkbox('图片输入', 'inputModalities', 'image'),
      checkbox('文本输出', 'outputModalities', 'text'), checkbox('图像输出', 'outputModalities', 'image'),
      checkbox('流式回复', 'supports', 'stream'), checkbox('工具调用', 'supports', 'tools'),
      checkbox('结构化输出', 'supports', 'structured-output'),
    ]),
    h('p', { class: 'note' }, '自定义编程模型需要其绑定满足所选能力。未确认的模型不会自动变成可用。'),
  ]);
}
