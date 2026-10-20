import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import type { ToolCallContext } from 'cortico/core/types.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { readRules, TERRARIUM_RULE_TOPICS } from '../src/rules.ts';
import { TerrariumWorld } from '../src/world.ts';

it('reads every bundled topic before startup without creating or claiming a habitat', async () => {
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, stateFile: '/unused/state.json', timezone: 'UTC' });
  const tool = world.tools().find(t => t.name === 'terrarium_rules')!;
  for (const topic of TERRARIUM_RULE_TOPICS) {
    const result = await tool.handler({ topic }, {} as ToolCallContext);
    expect(result).toBe(await readRules(topic));
    expect(String(result).length).toBeGreaterThan(100);
  }
  await expect(tool.handler({ topic: '../ENV_PROMPT' }, {} as ToolCallContext)).rejects.toThrow('Unknown rules topic');
});

it('keeps the startup prompt smaller than the complete reference while retaining scoring and owner-contact rules', async () => {
  const prompt = await readFile(new URL('../src/ENV_PROMPT.md', import.meta.url), 'utf8');
  const rules = await Promise.all(TERRARIUM_RULE_TOPICS.map(readRules));
  expect(prompt.length).toBeLessThan(rules.join('').length / 2);
  expect(prompt).toContain('100%、50%、25%');
  expect(prompt).toContain('不要因日常事件');
  expect(prompt).toContain('terrarium_rules');
});
