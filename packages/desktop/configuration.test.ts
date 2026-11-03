import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfiguration, exportConfiguration } from './configuration.ts';

test('packaged configuration loads from user data independent of the working directory', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cue-config-'));
  try {
    const userData = path.join(root, 'profile'); mkdirSync(userData);
    writeFileSync(path.join(userData, 'config.env'), 'TWITCH_CLIENT_ID=installed-client\nOPENAI_API_KEY=test-key\nELEVENLABS_API_KEY=unrelated\nCUE_DEV_URL=https://untrusted.invalid\n');
    writeFileSync(path.join(root, '.env'), 'TWITCH_CLIENT_ID=checkout-client\n');
    const env: Record<string, string | undefined> = {};
    loadConfiguration({ packaged: true, projectRoot: root, userData, env });
    assert.equal(env.TWITCH_CLIENT_ID, 'installed-client');
    assert.equal(env.OPENAI_API_KEY, 'test-key');
    assert.equal(env.ELEVENLABS_API_KEY, undefined);
    assert.equal(env.CUE_DEV_URL, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('environment overrides files, including explicit empty values for isolated demos', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cue-config-'));
  try {
    writeFileSync(path.join(root, '.env'), 'TWITCH_CLIENT_ID=client\nOPENAI_API_KEY=key\nCUE_OVERLAY_PORT=4318\n');
    const env: Record<string, string | undefined> = { OPENAI_API_KEY: '', CUE_OVERLAY_PORT: '0' };
    loadConfiguration({ packaged: false, projectRoot: root, userData: path.join(root, 'missing'), env });
    assert.equal(env.OPENAI_API_KEY, ''); assert.equal(env.CUE_OVERLAY_PORT, '0');
    assert.equal(env.TWITCH_CLIENT_ID, 'client');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('explicit config files work for packaged apps and missing explicit paths fail clearly', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cue-config-'));
  try {
    const file = path.join(root, 'settings.env');
    writeFileSync(file, 'TWITCH_CLIENT_ID=explicit\n');
    const env: Record<string, string | undefined> = { CUE_CONFIG_PATH: file };
    loadConfiguration({ packaged: true, projectRoot: '/', userData: '/', env });
    assert.equal(env.TWITCH_CLIENT_ID, 'explicit');
    assert.throws(() => loadConfiguration({ packaged: true, projectRoot: '/', userData: '/', env: { CUE_CONFIG_PATH: file + '.missing' } }), /configuration/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('configuration export excludes unrelated secrets and round trips runtime values', () => {
  const exported = exportConfiguration('TWITCH_CLIENT_ID=client\nOPENAI_API_KEY=test-key\nOPENAI_MODEL=gpt-4o-mini\nELEVENLABS_API_KEY=never-export\n');
  assert.match(exported, /TWITCH_CLIENT_ID="client"/);
  assert.ok(!exported.includes('ELEVENLABS')); assert.ok(!exported.includes('never-export'));
});
