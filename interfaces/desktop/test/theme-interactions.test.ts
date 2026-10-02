import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/ui/styles/tdesign-theme.css', import.meta.url), 'utf8');
const darkStart = css.indexOf(':root.dark,');
const commonStart = css.indexOf('\n:root {', darkStart);
assert.ok(darkStart > 0 && commonStart > darkStart);
const themes = {
  light: css.slice(0, darkStart),
  dark: css.slice(darkStart, commonStart),
};

function luminance(hex: string): number {
  assert.match(hex, /^#[\da-f]{6}$/i);
  const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

for (const [theme, block] of Object.entries(themes)) {
  const tokens = new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
  function color(name: string): string {
    const value = tokens.get(name);
    assert.ok(value, `missing ${theme} ${name}`);
    const alias = /^var\((--[\w-]+)\)$/.exec(value);
    return alias ? color(alias[1]) : value;
  }

  test(`${theme}: neutral interaction surfaces have explicit theme values`, () => {
    const names = [...tokens.keys()].filter((name) => /^--td-bg-color-(?:container|secondarycontainer|component|secondarycomponent)(?:-(?:hover|active|select|disabled))?$/.test(name));
    assert.ok(names.length >= 12);
    for (const name of names) assert.match(tokens.get(name)!, /^#[\da-f]{6}$/i, name);
    for (const name of ['--td-component-stroke', '--td-border-level-2-color']) {
      assert.match(tokens.get(name)!, /^#[\da-f]{6}$/i, name);
    }
  });

  test(`${theme}: hover and active increase neutral emphasis in order`, () => {
    for (const surface of ['container', 'secondarycontainer', 'component', 'secondarycomponent']) {
      const values = ['', '-hover', '-active'].map((state) => luminance(color(`--td-bg-color-${surface}${state}`)));
      assert.ok(theme === 'dark' ? values[0] < values[1] && values[1] < values[2] : values[0] > values[1] && values[1] > values[2], surface);
    }
  });

  test(`${theme}: primary, secondary and weak text pass AA across enabled interaction surfaces`, () => {
    const surfaces = [...tokens.keys()].filter((name) => name.startsWith('--td-bg-color-') && !name.endsWith('-disabled') && name !== '--td-bg-color-specialcomponent');
    assert.equal(surfaces.length, 15);
    for (const text of ['primary', 'secondary', 'placeholder']) {
      const foreground = luminance(color(`--td-text-color-${text}`));
      const ratios = surfaces.map((name) => {
        const background = luminance(color(name));
        const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        assert.ok(Number.isFinite(ratio));
        assert.ok(ratio >= 4.5, `${text} on ${name}: ${ratio.toFixed(2)}:1`);
        return ratio;
      });
      console.log(`${theme} ${text}: minimum ${Math.min(...ratios).toFixed(2)}:1 (${surfaces.length} surfaces)`);
    }
  });
}
