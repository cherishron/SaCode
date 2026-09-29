// 分屏槽位纯逻辑:按需增长的 (conversationId | null)[]。哪些槽位可见由
// 布局树(split-tree.ts)的叶集决定;运行期关闭格则显式清掉内容。
// 判定与变换全是纯函数,渲染层(workbench.ts)只做接线,产品语义单测
// 钉在 test/split-slots.test.ts。
export type Slots = readonly (string | null)[];
/** 装载(move 语义):同一会话禁止双格并存——装载前先把该会话从其他槽
 *  摘掉,判重收口在此单点,调用方不必各自防。 */
export function assign(slots: Slots, index: number, id: string): Slots {
  if (!Number.isSafeInteger(index) || index < 0) return slots;
  const length = Math.max(slots.length, index + 1);
  return Array.from({ length }, (_, i) => (i === index ? id : slots[i] === id ? null : (slots[i] ?? null)));
}
/** 卸载:把槽位退回空槽;空槽保持原引用,避免白落盘。 */
export function eject(slots: Slots, index: number): Slots {
  if (!slots[index]) return slots;
  return slots.map((s, i) => (i === index ? null : s));
}
/** 会话表剪枝:被删会话的槽退回空槽。只许用**成功加载**的全表调用——
 *  失败时拿空表来剪等于把所有槽清空(守卫在调用方刷新的成功分支)。
 *  无变化返回原引用。 */
export function prune(slots: Slots, alive: ReadonlySet<string>): Slots {
  if (slots.every((s) => !s || alive.has(s))) return slots;
  return slots.map((s) => (s && !alive.has(s) ? null : s));
}
/** 可见槽位序(布局树的叶集,阅读序)里第一个空槽;无空槽返回 null。 */
export function firstEmptyIn(slots: Slots, indices: readonly number[]): number | null {
  for (const i of indices) if (slots[i] == null) return i;
  return null;
}
/** 首开播种:槽位全空且有当前会话时首叶带入——从哪来先看哪,不出现
 *  点开全是空白的断裂;有存档则原样恢复。 */
export function seed(slots: Slots, currentId: string | null, target = 0): Slots {
  if (!currentId || slots.some(Boolean)) return slots;
  return assign(slots, target, currentId);
}
/** 工作台 dnd 协议(私有 MIME,不与文件拖入相混):
 *  SWAP = 按住格头标题换位;LOAD = 任务列行拖进格定点装载。 */
export const SWAP_MIME = 'application/x-sacode-split-slot';
export const LOAD_MIME = 'application/x-sacode-split-load';
