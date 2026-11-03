import { packager } from '@electron/packager';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const electron = require('electron/package.json') as { version: string };
if (process.platform !== 'darwin') throw Error('The macOS application must be built on macOS.');
const architecture = process.arch;
if (architecture !== 'arm64' && architecture !== 'x64')
  throw Error('Unsupported macOS architecture.');
const applications = await packager({
  dir: process.cwd(),
  name: 'CUE',
  executableName: 'CUE',
  appBundleId: 'com.lukietee.cue',
  appCategoryType: 'public.app-category.entertainment',
  platform: 'darwin',
  arch: architecture,
  electronVersion: electron.version,
  icon: path.resolve('assets/cue.icns'),
  out: 'release',
  overwrite: true,
  asar: true,
  osxSign: {
    identity: '-',
    identityValidation: false,
    continueOnError: false,
    optionsForFile: () => ({ hardenedRuntime: false }),
  },
  prune: true,
  ignore: [
    /^\/(?:\.git|\.cue-git|\.github|apps|packages|docs|scripts|fixtures|release)(?:\/|$)/,
    /^\/\.env(?:\.|$)/,
  ],
});
console.log(`CUE application: ${applications[0]}/CUE.app`);
