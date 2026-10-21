import { readFileSync } from 'node:fs';
import { platform, release } from 'node:os';
import type { ClientSystem } from './report-protocol.ts';

export function parseClientSystem(platform: string, kernelVersion: string, systemInfo = ''): ClientSystem {
  if (platform === 'win32') return { name: 'Windows', version: kernelVersion };
  if (platform === 'darwin') {
    const productVersion = /<key>ProductVersion<\/key>\s*<string>([0-9.]+)<\/string>/.exec(systemInfo)?.[1];
    return { name: 'macOS', version: productVersion ?? `Darwin ${kernelVersion}` };
  }
  if (platform === 'linux') {
    const pretty = /^PRETTY_NAME=(.*)$/m.exec(systemInfo)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2').replace(/\\(["\\$`])/g, '$1');
    return { name: 'Linux', version: pretty && pretty.length <= 100 && !/[\x00-\x1f\x7f]/.test(pretty) ? `${pretty} (kernel ${kernelVersion})` : kernelVersion };
  }
  return { name: platform, version: kernelVersion };
}

function readClientSystem(): ClientSystem {
  const hostPlatform = platform();
  const file = hostPlatform === 'linux' ? '/etc/os-release' : hostPlatform === 'darwin' ? '/System/Library/CoreServices/SystemVersion.plist' : undefined;
  let systemInfo = '';
  if (file) {
    try { systemInfo = readFileSync(file, 'utf8'); } catch { /* The kernel version remains available when the OS release file cannot be read. */ }
  }
  return parseClientSystem(hostPlatform, release(), systemInfo);
}

export const TERRARIUM_CLIENT_SYSTEM = readClientSystem();
