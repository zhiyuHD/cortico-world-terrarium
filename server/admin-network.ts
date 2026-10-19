import { createServer, type RequestListener, type IncomingMessage } from 'node:http';

function ipv4(value: string): number | undefined {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) return;
  const parts = value.split('.').map(Number);
  if (parts.some(part => part > 255)) return;
  return parts.reduce((result, part) => (result * 256 + part) >>> 0, 0);
}
export function privateAddress(host: string): boolean {
  const value = ipv4(host);
  return value !== undefined && (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('127.') || (value >>> 20) === 0xac1);
}
export function adminNetwork(host: string, cidr: string): (address: string) => boolean {
  if (!privateAddress(host)) throw new Error('Admin host must be a private or loopback IPv4 address');
  const [network, bits, extra] = cidr.split('/');
  const address = ipv4(network), prefix = Number(bits);
  if (extra !== undefined || !privateAddress(network) || !/^\d+$/.test(bits ?? '') || prefix < 8 || prefix > 32) throw new Error('Invalid private admin CIDR');
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const contains = (ip: string) => { const value = ipv4(ip.replace(/^::ffff:/, '')); return value !== undefined && privateAddress(ip.replace(/^::ffff:/, '')) && ((value & mask) >>> 0) === ((address! & mask) >>> 0); };
  if (!contains(host)) throw new Error('Admin host must belong to the allowed CIDR');
  return contains;
}
export function trustedAdminRequest(req: IncomingMessage, host: string, allowed: (address: string) => boolean): boolean {
  const authority = `${host}:${req.socket.localPort}`;
  return allowed(req.socket.remoteAddress ?? '') && req.headers.host === authority && (req.headers.origin === undefined || req.headers.origin === `http://${authority}`);
}
export function createAdminServer(host: string, cidr: string, handler: RequestListener) {
  const allowed = adminNetwork(host, cidr);
  return createServer((req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (!trustedAdminRequest(req, host, allowed)) { res.writeHead(403); res.end('Forbidden'); return; }
    handler(req, res);
  });
}
