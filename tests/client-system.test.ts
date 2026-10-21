import { platform, release } from 'node:os';
import { expect, it } from 'vitest';
import { parseClientSystem, TERRARIUM_CLIENT_SYSTEM } from '../src/client-system.ts';
import { validClientSystem } from '../src/report-protocol.ts';
import { reportClientMetadata } from '../src/version.ts';

it('reports Windows build, Linux distribution and macOS product versions', () => {
  expect(parseClientSystem('win32', '10.0.26100')).toEqual({ name: 'Windows', version: '10.0.26100' });
  expect(parseClientSystem('linux', '6.12.0', 'NAME=TestOS\nPRETTY_NAME="TestOS 2 LTS"\n')).toEqual({ name: 'Linux', version: 'TestOS 2 LTS (kernel 6.12.0)' });
  expect(parseClientSystem('darwin', '24.0.0', '<plist><dict><key>ProductVersion</key>\n<string>15.0.1</string></dict></plist>')).toEqual({ name: 'macOS', version: '15.0.1' });
});

it('falls back to kernel releases when product metadata is unavailable or invalid', () => {
  expect(parseClientSystem('linux', '6.12.0')).toEqual({ name: 'Linux', version: '6.12.0' });
  expect(parseClientSystem('linux', '6.12.0', 'PRETTY_NAME="bad\u0000value"')).toEqual({ name: 'Linux', version: '6.12.0' });
  expect(parseClientSystem('darwin', '24.0.0', 'not a plist')).toEqual({ name: 'macOS', version: 'Darwin 24.0.0' });
  expect(parseClientSystem('freebsd', '14.2')).toEqual({ name: 'freebsd', version: '14.2' });
});

it('attaches valid metadata from the running host without hostnames or environment dumps', () => {
  const system = reportClientMetadata().clientSystem;
  expect(system).toEqual(TERRARIUM_CLIENT_SYSTEM);
  expect(validClientSystem(system)).toBe(true);
  expect(Object.keys(system).sort()).toEqual(['name', 'version']);
  if (platform() === 'linux') expect(system.version).toContain(release());
});

it.each([null, [], {}, { name: 'Linux' }, { name: '', version: '1' }, { name: 'Linux', version: '1\n2' }, { name: 'Linux', version: '1', hostname: 'private' }, { name: 'Linux', version: 'v'.repeat(201) }])('rejects malformed client system metadata: %j', value => {
  expect(validClientSystem(value)).toBe(false);
});
