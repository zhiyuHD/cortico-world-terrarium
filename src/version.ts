import { readFileSync } from 'node:fs';
import { validClientVersion } from './report-protocol.ts';

export const TERRARIUM_CLIENT_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export function reportClientMetadata(): { clientVersion: string; coopanionVersion?: string } {
  const coopanionVersion = process.env.COOPANION_VERSION?.trim();
  return { clientVersion: TERRARIUM_CLIENT_VERSION, ...(validClientVersion(coopanionVersion) ? { coopanionVersion } : {}) };
}
