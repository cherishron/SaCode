/**
 * 键值对行编辑 — MCP env / headers 表单共用。
 * 纯函数，便于单测。空 key 的行在提交时被忽略。
 */

export interface KvRow {
  key: string;
  value: string;
}

export function recordToKv(
  record: Record<string, string> | undefined | null,
): KvRow[] {
  if (!record || typeof record !== 'object') return [{ key: '', value: '' }];
  const rows = Object.entries(record).map(([key, value]) => ({
    key,
    value: String(value ?? ''),
  }));
  return rows.length ? rows : [{ key: '', value: '' }];
}

/** 只收集 key 非空的行；重复 key 后者覆盖前者。 */
export function kvToRecord(rows: readonly KvRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    out[key] = row.value;
  }
  return out;
}

export function appendKvRow(rows: KvRow[]): KvRow[] {
  return [...rows, { key: '', value: '' }];
}

export function dropKvRow(rows: readonly KvRow[], index: number): KvRow[] {
  const next = rows.filter((_, i) => i !== index);
  return next.length ? next : [{ key: '', value: '' }];
}
