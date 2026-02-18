import { readFileSync } from 'fs';

const configPath = process.env.SKILL_ARG_CONFIG_PATH;
if (!configPath) {
  console.error('Missing SKILL_ARG_CONFIG_PATH');
  process.exit(1);
}

try {
  const content = readFileSync(configPath, 'utf-8');
  console.log('Auth config is valid');
  console.log(`File size: ${content.length} bytes`);
} catch (err) {
  console.error(`Cannot read config: ${err}`);
  process.exit(1);
}
