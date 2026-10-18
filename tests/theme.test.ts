// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const page = await readFile('server/index.html', 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/)![1];
let changed: () => void;
let dark = true;
let ready: (() => void) | undefined;

beforeEach(() => {
  const dom = (globalThis as unknown as { jsdom: { window: Window } }).jsdom;
  vi.stubGlobal('localStorage', Object.getOwnPropertyDescriptor(dom.window, 'localStorage')!.get!.call(dom.window));
  localStorage.clear(); document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="#f5f5ed">';
  document.body.innerHTML = '<button id="theme-toggle"><span></span></button>';
  dark = true;
  vi.stubGlobal('matchMedia', () => ({ get matches() { return dark; }, addEventListener(_event: string, listener: () => void) { changed = listener; } }));
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'DOMContentLoaded') ready = listener as () => void;
    else add(type, listener, options);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const boot = () => { window.eval(script); };

it('applies system darkness before mounting controls and tracks system changes', () => {
  boot();
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.querySelector('meta')!.content).toBe('#101916');
  ready!();
  dark = false; changed();
  expect(document.documentElement.dataset.theme).toBe('light');
});

it('remembers explicit theme, cycles modes and ignores system changes while overridden', () => {
  localStorage.setItem('terrarium.theme', 'dark'); boot(); ready!();
  const button = document.querySelector('button')!;
  button.click();
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(localStorage.getItem('terrarium.theme')).toBe('light');
  changed();
  expect(document.documentElement.dataset.theme).toBe('light');
  button.click();
  expect(document.documentElement.dataset.themePreference).toBe('system');
  expect(document.documentElement.dataset.theme).toBe('dark');
});

it('keeps switching usable when local storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  boot(); ready!(); document.querySelector('button')!.click();
  expect(document.documentElement.dataset.themePreference).toBe('dark');
});
