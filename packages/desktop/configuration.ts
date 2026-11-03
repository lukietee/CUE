import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

export const configurationKeys = [
  'TWITCH_CLIENT_ID', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'CUE_OVERLAY_PORT', 'CUE_DEMO_MODE', 'CUE_REMEMBER_CONNECTIONS',
] as const;
type Options = {
  packaged: boolean;
  projectRoot: string;
  userData: string;
  env: Record<string, string | undefined>;
};

/** Process environment wins, then a per-user file, then the development checkout. */
export function loadConfiguration(options: Options): string | undefined {
  const explicit = options.env.CUE_CONFIG_PATH;
  const files = explicit
    ? [path.resolve(explicit)]
    : [path.join(options.userData, 'config.env'),
        ...(!options.packaged ? [path.join(options.projectRoot, '.env')] : [])];
  let loaded: string | undefined;
  for (const file of files) {
    let contents: string;
    try {
      contents = readFileSync(file, 'utf8');
    } catch (error) {
      if (!explicit && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw Error('Could not read CUE configuration. Check the configuration file is accessible.');
    }
    const parsed = parseEnv(contents);
    for (const key of configurationKeys) {
      if (options.env[key] === undefined && parsed[key] !== undefined) options.env[key] = parsed[key];
    }
    loaded ??= file;
  }
  return loaded;
}

/** Export only CUE runtime settings; never include unrelated service keys. */
export function exportConfiguration(contents: string): string {
  const values = parseEnv(contents);
  return configurationKeys.filter(key => values[key] !== undefined)
    .map(key => `${key}=${JSON.stringify(values[key])}`).join('\n') + '\n';
}
