import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { newAquarium, stockFish } from '../src/aquarium.ts';
import { newState, saveState } from '../src/state.ts';
import { TerrariumWorld } from '../src/world.ts';
import { createCareControls } from '../webui/care.ts';

/** The panel controls only need a tree of elements, so the test builds that subset instead of a browser. */
class FakeElement {
  className = '';
  textContent = '';
  disabled = false;
  title = '';
  children: FakeElement[] = [];
  listeners: Array<() => void> = [];
  setAttribute() {}
  style = { setProperty() {} };
  append(...nodes: FakeElement[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: FakeElement[]) { this.children = [...nodes]; }
  addEventListener(_event: string, handler: () => void) { this.listeners.push(handler); }
  find(predicate: (element: FakeElement) => boolean): FakeElement | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) { const hit = child.find(predicate); if (hit) return hit; }
    return undefined;
  }
  labels(): string[] { return this.children.flatMap(child => [child.textContent, ...child.labels()]).filter(Boolean); }
}

const element = () => new FakeElement() as unknown as HTMLElement;

function careHarness(habitat: 'land' | 'water' = 'water') {
  const invoked: Array<Record<string, unknown>> = [];
  const ctx = {
    language: 'zh-CN',
    signal: new AbortController().signal,
    invoke: async (_method: string, args: unknown[]) => { invoked.push(args[0] as Record<string, unknown>); return {}; },
    ui: {
      h: () => element(),
      button: (label: string) => { const button = new FakeElement() as unknown as HTMLElement & FakeElement; (button as unknown as FakeElement).textContent = label; return button; },
    },
  } as unknown as WebUiPanelContext;
  const controls = createCareControls(ctx, habitat, async () => {});
  return { controls, invoked };
}

it('offers stocking, feeding and water changes in the water panel', () => {
  const { controls } = careHarness();
  controls.update({ progression: { level: 1, peakScore: 0, guideStep: 0, guideSkipped: false, actions: [] }, plants: [{ id: 'plant-1', x: 1, y: 1, species: 'elodea' }], fish: [{ id: 'fish-1' }], food: [], seeds: [] } as never, { x: 2, y: 2 });
  const labels = (controls.el as unknown as FakeElement).labels().join(' | ');
  for (const expected of ['放养 guppy', '放养 goldfish', '选中格投喂', '换水 20%', '换水 50%', 'fish-1 移到选中格', 'plant-1 移出']) expect(labels).toContain(expected);
  for (const forbidden of ['terrarium_stock_fish', 'undefined']) expect(labels).not.toContain(forbidden);
});

it('offers harvesting and selling in the land panel', () => {
  const { controls } = careHarness('land');
  controls.update({ progression: { level: 1, peakScore: 0, guideStep: 0, guideSkipped: false, actions: [] }, plants: [{ id: 'plant-7', x: 1, y: 1, species: 'watermelon' }], produce: { watermelon: 2 }, soil: [{ x: 1, y: 1 }], nests: [] } as never, { x: 1, y: 1 });
  const labels = (controls.el as unknown as FakeElement).labels().join(' | ');
  expect(labels).toContain('收 plant-7 西瓜');
  expect(labels).toContain('卖 西瓜 ×2');
});

async function startWorld() {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-panel-'));
  const land = join(dir, 'state.json'), water = join(dir, 'water', 'state.json');
  await mkdir(join(dir, 'water'), { recursive: true });
  const now = Date.parse('2026-06-01T06:00:00Z');
  await saveState(land, newState(now));
  const aquarium = newAquarium(now);
  stockFish(aquarium, 'guppy', 2, 2);
  await saveState(water, aquarium);
  const host = { log: { warn() {} }, pushEvent: async (event: unknown) => event };
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'Asia/Shanghai', stateFile: land, waterStateFile: water, now: () => now + 60_000 });
  await world.start(host as never);
  return { world, dir, cleanup: async () => { await world.stop(); await rm(dir, { recursive: true, force: true }); } };
}

it('carries a panel request to stock a fish through to the saved water box', async () => {
  const { world, cleanup } = await startWorld();
  try {
    const invoke = (panel: string, method: string, args: unknown[] = []) => world.webUi().invoke!(panel, method, args);
    const before = await invoke('water', 'state') as { state: { fish: unknown[] } };
    const after = await invoke('water', 'care', [{ tool: 'terrarium_stock_fish', species: 'medaka', x: 3, y: 3 }]) as { state: { fish: unknown[] } };
    expect(after.state.fish.length).toBe(before.state.fish.length + 1);
    const changed = await invoke('water', 'care', [{ tool: 'terrarium_change_water', percent: 20 }]) as { state: { oxygen: number } };
    expect(changed.state.oxygen).toBeGreaterThan(0);
  } finally { await cleanup(); }
});
