import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedRendererNavigation, normalizeRendererEntryUrl } from './navigation.ts';

test('development entry canonicalizes the missing root slash used by Vite full reload', () => {
  const configured = 'http://127.0.0.1:5173';
  assert.equal(normalizeRendererEntryUrl(configured), `${configured}/`);
  assert.equal(isAllowedRendererNavigation(`${configured}/`, configured), true);
  assert.equal(isAllowedRendererNavigation(configured, `${configured}/`), true);
  assert.equal(isAllowedRendererNavigation(`${configured}/#setup`, configured), true);
});

test('development navigation stays limited to the exact local entry document', () => {
  const entry = 'http://127.0.0.1:5173/';
  for (const target of [
    'http://127.0.0.1:5173/other',
    'http://127.0.0.1:5173/index.html',
    'http://127.0.0.1:5173/?redirect=https://example.com',
    'http://127.0.0.1:5173/?t=123',
    'http://127.0.0.1:5174/',
    'http://localhost:5173/',
    'https://127.0.0.1:5173/',
    'https://example.com/',
    'http://user:password@127.0.0.1:5173/',
    'file:///tmp/index.html',
    'javascript:alert(1)',
    'data:text/html,hello',
    'not a URL',
  ]) assert.equal(isAllowedRendererNavigation(target, entry), false, target);
});

test('production reload and hash navigation allow only the exact bundled file', () => {
  const entry = 'file:///Applications/CUE.app/Contents/Resources/app/dist/index.html';
  assert.equal(isAllowedRendererNavigation(entry, entry), true);
  assert.equal(isAllowedRendererNavigation(`${entry}#recap`, entry), true);
  assert.equal(isAllowedRendererNavigation('file:///tmp/index.html', entry), false);
  assert.equal(isAllowedRendererNavigation(`${entry}?debug=true`, entry), false);
  assert.equal(isAllowedRendererNavigation(entry.replace('index.html', 'settings.html'), entry), false);
});

test('untrusted entry configuration fails closed', () => {
  for (const entry of [
    'https://example.com/',
    'http://0.0.0.0:5173/',
    'http://localhost:5173/',
    'http://127.0.0.1:5173/another-document',
    'http://127.0.0.1:5173/?secret=value',
    'http://user@127.0.0.1:5173/',
    'file://remote-host/share/index.html',
    'file:///tmp/another.html',
    'invalid',
  ]) {
    assert.throws(() => normalizeRendererEntryUrl(entry));
    assert.equal(isAllowedRendererNavigation(entry, entry), false);
  }
});
