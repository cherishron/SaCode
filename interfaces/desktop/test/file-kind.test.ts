import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fileKind,
  highlightLanguage,
  iconTone,
  previewMode,
  sortTreeEntries,
} from '../src/ui/utils/file-kind.ts';

test('sortTreeEntries puts folders first then names', () => {
  const sorted = sortTreeEntries([
    { name: 'zebra.txt', isDir: false },
    { name: 'Apple', isDir: true },
    { name: 'readme.md', isDir: false },
    { name: 'src', isDir: true },
    { name: 'a.js', isDir: false },
  ]);
  assert.deepEqual(
    sorted.map((e) => e.name),
    ['Apple', 'src', 'a.js', 'readme.md', 'zebra.txt'],
  );
});

test('fileKind maps extension categories', () => {
  assert.equal(fileKind('lib.rs', false), 'code');
  assert.equal(fileKind('a.md', false), 'markdown');
  assert.equal(fileKind('t.json', false), 'data');
  assert.equal(fileKind('x.png', false), 'image');
  assert.equal(fileKind('src', true), 'folder');
});

test('previewMode selects markdown or code', () => {
  assert.equal(previewMode('README.md'), 'markdown');
  assert.equal(previewMode('main.rs'), 'code');
  assert.equal(previewMode('notes.txt'), 'code');
  assert.equal(previewMode('photo.png'), 'text');
});

test('highlightLanguage maps known languages', () => {
  assert.equal(highlightLanguage('a.ts'), 'typescript');
  assert.equal(highlightLanguage('a.rs'), 'rust');
  assert.equal(highlightLanguage('a.unknown'), null);
});

test('iconTone distinguishes folder and extensions', () => {
  assert.equal(iconTone('docs', true), 'folder');
  assert.equal(iconTone('x.ts'), 'typescript');
  assert.equal(iconTone('x.rs'), 'rust');
});
