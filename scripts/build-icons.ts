import sharp from 'sharp';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await mkdir('assets', { recursive: true });
await sharp('assets/cue.svg').resize(1024, 1024).png().toFile('assets/cue.png');
if (process.platform === 'darwin') {
  const scratch = await mkdtemp(path.join(tmpdir(), 'cue-icons-'));
  const iconset = path.join(scratch, 'CUE.iconset');
  await mkdir(iconset);
  try {
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
        await sharp('assets/cue.svg')
          .resize(size * scale, size * scale)
          .png()
          .toFile(path.join(iconset, name));
      }
    }
    await promisify(execFile)('iconutil', [
      '-c',
      'icns',
      iconset,
      '-o',
      path.resolve('assets/cue.icns'),
    ]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
console.log('CUE app icons generated.');
