import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileStyle, parse } from '@vue/compiler-sfc';

const source = readFileSync(new URL('../src/ui/components/ChatPane.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);

test('message stream children retain their content height instead of flex shrinking', () => {
  const css = descriptor.styles.map((style) => style.content).join('\n');
  const compiled = compileStyle({ source: css, filename: 'ChatPane.vue', id: 'data-v-stream-test', scoped: true });
  assert.equal(compiled.errors.length, 0);
  const rules = [...compiled.code.matchAll(/([^{}]+)\{([^}]+)\}/g)];
  const streamChildren = rules.find((rule) => rule[1].trim().replace(/\s+/g, ' ') === '.chat-stream[data-v-stream-test] > *');
  assert.ok(streamChildren, 'compiled scope must cover child component roots');
  assert.match(streamChildren[2], /flex-shrink\s*:\s*0\s*;/);
});
