import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { _electron, type Locator } from 'playwright';
import electronPath from 'electron';

// Record the actual Electron application in an isolated Demo Mode profile.
// Artwork adds only a video frame, chapter headings, captions, and a pointer.
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
try { process.loadEnvFile(); } catch { /* Optional local credentials. */ }
const output = path.resolve('release/demo');
await mkdir(output, { recursive: true });
type Chapter = { id: string; title: string; caption: string; seconds: number; narration: string };
type Frame = { file: string; time: number };
type Capture = Chapter & { duration: number; audio: string; frames: Frame[] };
const storyboard = JSON.parse(await readFile('docs/demo-video/storyboard.json', 'utf8')) as Chapter[];
const voiceId = process.env.ELEVENLABS_VOICE_ID || 'TX3LPaxmHKxFdv7VOQHJ';
const model = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const silent = process.argv.includes('--silent');
const renderOnly = process.argv.includes('--render-only');

async function command(program: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', error = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { error = (error + d.toString()).slice(-8000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(out) : reject(Error(`${program} exited ${code}: ${error}`)));
  });
}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function duration(file: string) {
  return Number((await command('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])).trim());
}
async function speech(chapter: Chapter, index: number) {
  const hash = createHash('sha256').update(JSON.stringify({ voiceId, model, text: chapter.narration })).digest('hex').slice(0, 10);
  const audio = path.join(output, `${chapter.id}-${hash}.mp3`);
  if (silent) return { audio: '', duration: chapter.seconds };
  if (!existsSync(audio)) {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw Error('Set ELEVENLABS_API_KEY in .env, or use --silent for a captioned preview.');
    console.log(`Generating narration ${index + 1}/${storyboard.length}: ${chapter.title}`);
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: chapter.narration, model_id: model,
        previous_text: storyboard[index - 1]?.narration, next_text: storyboard[index + 1]?.narration,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.12, use_speaker_boost: true, speed: 1.05 } }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw Error(`ElevenLabs returned HTTP ${response.status} for ${chapter.id}. Check key permissions, voice access, and available credits.`);
    await writeFile(audio, Buffer.from(await response.arrayBuffer()));
  }
  return { audio, duration: Math.max(chapter.seconds, await duration(audio) + 1.0) };
}
function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
async function artwork(chapter: Chapter, index: number) {
  const file = path.join(output, `${chapter.id}-frame.png`);
  const svg = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#10091d"/><stop offset="1" stop-color="#25113f"/></linearGradient></defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <rect x="0" y="0" width="1920" height="5" fill="#9146ff"/>
  <g font-family="Arial,Helvetica,sans-serif"><text x="64" y="76" font-size="54" font-weight="bold" fill="white">CUE<tspan fill="#a970ff">.</tspan></text>
  <text x="270" y="70" font-size="31" font-weight="bold" fill="white">${escapeXml(chapter.title)}</text>
  <rect x="1610" y="35" width="246" height="43" rx="21" fill="#3a2456"/><text x="1733" y="63" text-anchor="middle" font-size="18" fill="#e5d4ff">PRODUCT WALKTHROUGH</text>
  <rect x="299" y="107" width="1322" height="830" rx="8" fill="#644589"/>
  <text x="960" y="994" text-anchor="middle" font-size="27" fill="#f4edff">${escapeXml(chapter.caption)}</text>
  <text x="64" y="1048" font-size="17" fill="#bba6d4">REAL APP CAPTURE · DEMO MODE</text>
  <text x="1856" y="1048" text-anchor="end" font-size="17" fill="#bba6d4">${String(index + 1).padStart(2, '0')} / ${String(storyboard.length).padStart(2, '0')}</text>
  </g></svg>`;
  // Use the existing Electron dependency to rasterize framing artwork.
  const scratch = await mkdtemp(path.join(tmpdir(), 'cue-video-artwork-'));
  const bootstrap = path.join(scratch, 'artwork.cjs');
  await writeFile(bootstrap, `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(scratch, 'profile'))});
app.whenReady().then(() => {
 const window = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true,
   webPreferences: { sandbox: true, backgroundThrottling: false } });
 window.loadURL('data:text/html,<html></html>');
});`);
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete environment.ELECTRON_RUN_AS_NODE;
  environment.ELEVENLABS_API_KEY = '';
  const renderer = await _electron.launch({ executablePath: electronPath as unknown as string, args: [bootstrap], env: environment });
  try {
    const page = await renderer.firstWindow();
    await page.setContent(`<html><head><style>html,body{margin:0;padding:0;overflow:hidden}</style></head><body>${svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: file });
  } finally {
    await renderer.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy()));
    await renderer.close();
  }
  return file;
}

let captures: Capture[];
if (renderOnly) {
  captures = JSON.parse(await readFile(path.join(output, 'capture.json'), 'utf8'));
} else {
  const audio: { audio: string; duration: number }[] = [];
  for (let i = 0; i < storyboard.length; i++) audio.push(await speech(storyboard[i], i));
  const scratch = await mkdtemp(path.join(tmpdir(), 'cue-video-'));
  const bootstrap = path.join(scratch, 'bootstrap.cjs');
  await writeFile(bootstrap, `const { app } = require('electron');\napp.setPath('userData', ${JSON.stringify(path.join(scratch, 'profile'))});\nimport(${JSON.stringify(pathToFileURL(path.resolve('dist-electron/main.js')).href)});\n`);
  const env: Record<string, string> = { ...process.env, CUE_DEMO_MODE: 'true', CUE_OVERLAY_PORT: '0', OPENAI_API_KEY: '', TWITCH_CLIENT_ID: '' };
  delete env.CUE_DEV_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  // Voice credentials are used by this script only, never by the captured app.
  env.ELEVENLABS_API_KEY = '';
  const app = await _electron.launch({ executablePath: electronPath as unknown as string, args: [bootstrap], env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  captures = [];
  let recording = false;
  let captureLoop: Promise<void> | undefined;
  try {
    await page.waitForFunction(() => Boolean(window.cue));
    const browserWindow = await app.browserWindow(page);
    await browserWindow.evaluate(win => win.setContentSize(1440, 900));
    assert.equal(await page.evaluate(async () => (await window.cue!.getSnapshot()).settings.demo), true);
    await app.evaluate(({ dialog }) => {
      // Only the isolated demo instance bypasses the OS dialog after the visible app confirmation.
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      dialog.showMessageBoxSync = () => 1;
    });
    await page.getByLabel('Describe your stream').waitFor();
    await page.evaluate(() => {
      const cursor = document.createElement('div');
      cursor.id = 'demo-video-pointer';
      cursor.innerHTML = '<svg width="28" height="36" viewBox="0 0 28 36"><path d="M3 2L3 28L10 21L16 33L22 30L16 19L26 19Z" fill="#9146ff" stroke="white" stroke-width="2"/></svg>';
      Object.assign(cursor.style, { position: 'fixed', left: '690px', top: '440px', zIndex: '2147483647', pointerEvents: 'none', transition: 'left .55s cubic-bezier(.2,.8,.2,1), top .55s cubic-bezier(.2,.8,.2,1)', filter: 'drop-shadow(0 2px 3px #0005)' });
      document.body.append(cursor);
      const style = document.createElement('style');
      style.textContent = 'html,body,button,input,textarea,select,a { cursor: none !important; }';
      document.head.append(style);
    });
    async function point(target: Locator, click = false) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw Error('Cannot point at an invisible control.');
      await page.evaluate(({ x, y }) => {
        const pointer = document.getElementById('demo-video-pointer')!;
        pointer.style.left = `${x}px`; pointer.style.top = `${y}px`;
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      await pause(650);
      if (click) {
        await page.evaluate(() => document.getElementById('demo-video-pointer')!.animate([
          { transform: 'scale(1)' }, { transform: 'scale(.78)' }, { transform: 'scale(1)' },
        ], { duration: 260 }));
        await target.click();
        await pause(400);
      }
    }
    async function top() {
      await page.evaluate(() => document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' }));
      await pause(700);
    }
    const button = (name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
    const state = () => page.evaluate(() => window.cue!.getSnapshot());
    async function chapter(index: number, action: () => Promise<void>) {
      const spec = storyboard[index];
      const start = performance.now();
      const frames: Frame[] = [];
      const directory = path.join(scratch, spec.id);
      await mkdir(directory);
      recording = true;
      captureLoop = (async () => {
        while (recording) {
          const time = (performance.now() - start) / 1000;
          const file = path.join(directory, `${String(frames.length).padStart(5, '0')}.jpg`);
          await page.screenshot({ path: file, type: 'jpeg', quality: 90, animations: 'allow' });
          frames.push({ file, time });
          await pause(Math.max(0, 125 - (performance.now() - start - time * 1000)));
        }
      })();
      console.log(`Recording ${index + 1}/${storyboard.length}: ${spec.title}`);
      try {
        await action();
        await pause(Math.max(0, audio[index].duration * 1000 - (performance.now() - start)));
      } finally {
        recording = false;
        await captureLoop;
      }
      const elapsed = (performance.now() - start) / 1000;
      captures.push({ ...spec, duration: elapsed, audio: audio[index].audio, frames });
      await page.screenshot({ path: path.join(output, `${spec.id}.png`) });
      await writeFile(path.join(output, 'capture.json'), JSON.stringify(captures, null, 2));
    }
    await chapter(0, async () => { await pause(1800); await point(page.getByLabel('Describe your stream')); });
    await chapter(1, async () => {
      const brief = page.getByLabel('Describe your stream');
      await point(brief, true);
      await brief.pressSequentially('A city walk where chat picks the next challenge', { delay: 55 });
      await pause(700);
      await point(button('Create stream plan'), true);
      await button('Connect Twitch').waitFor();
    });
    await chapter(2, async () => {
      const title = page.getByLabel('Stream title', { exact: true });
      await point(title, true); await title.fill('Chat takes the wheel: a city adventure');
      await pause(1800);
      await page.getByText('The running order', { exact: true }).scrollIntoViewIfNeeded();
      await pause(2500); await top();
    });
    await chapter(3, async () => {
      await point(button('Connect Twitch'), true);
      await page.waitForFunction(async () => (await window.cue!.getSnapshot()).twitch.connected);
      await point(button('Connect OBS'), true);
      await page.waitForFunction(async () => (await window.cue!.getSnapshot()).obs.connected);
      await point(button('Stage in OBS'), true);
      await page.waitForFunction(async () => (await window.cue!.getSnapshot()).overlay.staged);
      // An actual browser loads and acknowledges the local overlay feed.
      await app.evaluate(async ({ BrowserWindow }, url) => {
        const overlay = new BrowserWindow({ show: false, width: 1920, height: 1080,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
        await overlay.loadURL(url);
      }, (await state()).overlay.url);
      await top();
    });
    await chapter(4, async () => {
      await point(button('Run readiness check'), true);
      await pause(1000);
      await point(button(/Ready\? Go live|Go live/i), true);
      await page.getByRole('dialog').waitFor();
      await pause(1600);
      await point(button('Yes, go live'), true);
      await page.waitForFunction(async () => (await window.cue!.getSnapshot()).status === 'live');
      await top();
    });
    await chapter(5, async () => {
      await point(button('Inject chat spike'), true);
      await page.waitForFunction(async () => (await window.cue!.getSnapshot()).actions.some(a => a.status === 'succeeded'));
      await top();
      await pause(3200);
      await point(page.getByRole('heading', { name: 'Director feed', exact: true }));
      await pause(2800);
      await page.getByRole('heading', { name: 'Conversation', exact: true }).scrollIntoViewIfNeeded();
      await pause(1500); await top();
    });
    await chapter(6, async () => {
      await point(button('Pause Director'), true);
      assert.equal((await state()).paused, true);
      const before = (await state()).actions.length;
      await pause(1300);
      await point(button('Inject chat spike'), true);
      assert.equal((await state()).actions.length, before);
      await pause(1600);
      await point(button('Resume Director'), true);
      await top();
    });
    await chapter(7, async () => {
      await point(button('End stream'), true);
      await page.getByRole('dialog').waitFor();
      await pause(800);
      await point(page.getByRole('dialog').getByRole('button', { name: 'End stream', exact: true }), true);
      await button('Markdown').waitFor();
      await top(); await pause(1600);
      const exportPath = path.join(output, 'session-recap.md');
      await app.evaluate(({ session }, file) => {
        session.defaultSession.once('will-download', (_event, item) => item.setSavePath(file));
      }, exportPath);
      await point(button('Markdown'), true);
      await pause(1200);
      assert.match(await readFile(exportPath, 'utf8'), /# /);
      await top();
    });
    assert.deepEqual(errors, [], 'Captured app must have no renderer errors.');
  } finally {
    recording = false;
    await captureLoop?.catch(() => {});
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
}

const segments: string[] = [];
let offset = 0;
const srt: string[] = [];
let subtitleIndex = 1;
const timestamp = (seconds: number) => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
for (let i = 0; i < captures.length; i++) {
  const chapter = captures[i];
  const frame = await artwork(chapter, i);
  const manifest = path.join(output, `${chapter.id}-frames.txt`);
  // Hold each captured frame until the next real capture timestamp, retaining input timing.
  const entries = chapter.frames.map((f, index) => {
    const start = index === 0 ? 0 : f.time;
    const end = chapter.frames[index + 1]?.time ?? chapter.duration;
    return `file '${f.file.replace(/'/g, "'\\''")}'\nduration ${Math.max(.001, end - start).toFixed(6)}`;
  });
  await writeFile(manifest, entries.join('\n') + `\nfile '${chapter.frames.at(-1)!.file}'\n`);
  const segment = path.join(output, `${chapter.id}.mp4`);
  const inputs = ['-f', 'concat', '-safe', '0', '-i', manifest, '-loop', '1', '-i', frame];
  if (chapter.audio) inputs.push('-i', chapter.audio);
  else inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
  const fadeOut = Math.max(0, chapter.duration - .2).toFixed(3);
  const filters = `[0:v]fps=30,scale=1312:820:flags=lanczos,setsar=1[ui];[1:v]format=yuv420p[bg];[bg][ui]overlay=304:112:shortest=1,fade=t=in:d=0.2,fade=t=out:st=${fadeOut}:d=0.2,fps=30[v];[2:a]adelay=250:all=1,apad,afade=t=out:st=${fadeOut}:d=0.2[a]`;
  console.log(`Rendering ${i + 1}/${captures.length}: ${chapter.title}`);
  await command('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', ...inputs, '-filter_complex', filters, '-map', '[v]', '-map', '[a]', '-t', chapter.duration.toFixed(3), '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', segment]);
  segments.push(segment);
  const sentences = chapter.narration.match(/[^.!?]+[.!?]+(?:\s|$)/g)?.map(s => s.trim()) ?? [chapter.narration];
  const speechSeconds = chapter.audio ? await duration(chapter.audio) : chapter.duration - .5;
  const characters = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
  let subOffset = offset + .25;
  for (const sentence of sentences) {
    const length = speechSeconds * sentence.length / characters;
    srt.push(`${subtitleIndex++}\n${timestamp(subOffset)} --> ${timestamp(subOffset + length)}\n${sentence}\n`);
    subOffset += length;
  }
  offset += chapter.duration;
}
const list = path.join(output, 'segments.txt');
await writeFile(list, segments.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'));
const final = path.join(output, 'cue-demo.mp4');
await writeFile(path.join(output, 'cue-demo.srt'), srt.join('\n'));
await writeFile(path.join(output, 'narration.txt'), storyboard.map(s => s.narration).join('\n\n') + '\n');
const metadata = path.join(output, 'chapters.ffmetadata');
let chapterStart = 0;
const chapterMetadata = captures.map(chapter => {
  const start = Math.round(chapterStart * 1000);
  chapterStart += chapter.duration;
  return `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${start}\nEND=${Math.round(chapterStart * 1000)}\ntitle=${chapter.title}`;
});
await writeFile(metadata, ';FFMETADATA1\ntitle=CUE — Your stream. Right on cue.\n' + chapterMetadata.join('\n') + '\n');
await command('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'concat', '-safe', '0', '-i', list,
  '-i', path.join(output, 'cue-demo.srt'), '-f', 'ffmetadata', '-i', metadata,
  '-map', '0:v', '-map', '0:a', '-map', '1:0', '-map_metadata', '2', '-map_chapters', '2',
  '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
  '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', '-movflags', '+faststart', final]);
console.log(`Finished: ${final} (${(await duration(final)).toFixed(1)} seconds)`);
