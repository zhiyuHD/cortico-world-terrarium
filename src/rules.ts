import { readFile } from 'node:fs/promises';

export const TERRARIUM_RULE_TOPICS = ['overview', 'land', 'water', 'care', 'records', 'ranking', 'reporting', 'expansion', 'forum', 'merchant'] as const;

/** Topics select bundled documentation and never resolve caller-supplied paths. */
export async function readRules(topic: unknown): Promise<string> {
  if (!TERRARIUM_RULE_TOPICS.includes(topic as typeof TERRARIUM_RULE_TOPICS[number])) throw new Error('Unknown rules topic');
  return readFile(new URL(`./rules/${topic}.md`, import.meta.url), 'utf8');
}
