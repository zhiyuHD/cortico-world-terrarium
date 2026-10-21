import { readFileSync } from 'node:fs';
import { TERRARIUM_CLIENT_SYSTEM } from './client-system.ts';
import type { ClientSystem } from './report-protocol.ts';
import { validClientVersion } from './report-protocol.ts';

export const TERRARIUM_CLIENT_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export function reportClientMetadata(): { clientVersion: string; coopanionVersion?: string; clientSystem: ClientSystem } {
  const coopanionVersion = process.env.COOPANION_VERSION?.trim();
  return { clientVersion: TERRARIUM_CLIENT_VERSION, clientSystem: TERRARIUM_CLIENT_SYSTEM, ...(validClientVersion(coopanionVersion) ? { coopanionVersion } : {}) };
}
