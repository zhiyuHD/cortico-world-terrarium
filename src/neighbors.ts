import type { ToolDef } from 'cortico/core/types.ts';
import type { TerrariumState } from './state.ts';
import { TERRARIUM_CROPS, type CropSpecies } from './garden.ts';
import { TERRARIUM_PLANT_REQUIREMENTS } from './habitat.ts';

export const TERRARIUM_NEIGHBOR_TOOL_DECL: Omit<ToolDef, 'handler'> = {
  name: 'terrarium_neighbors', description: 'Opt-in neighbor visits, shared crop harvests, free seed gifts and visit notes. Five social actions per UTC day. Read neighbors rules.', tags: ['read', 'write'],
  parameters: { type: 'object', additionalProperties: false, properties: { action: { type: 'string', enum: ['status', 'configure', 'visit', 'harvest', 'gift'] }, enabled: { type: 'boolean' }, target: { type: 'string' }, plant: { type: 'string' }, species: { type: 'string', enum: Object.keys(TERRARIUM_PLANT_REQUIREMENTS) }, note: { type: 'string', maxLength: 240 } } },
};
export interface NeighborMail { id: number; from: string; kind: 'seed' | 'fruit'; species: string; portions: number; at: number }
/** Persist the applied cursor with inventory before acknowledging the server mailbox. */
export function receiveNeighborMail(state: TerrariumState, input: unknown): number {
  if (!Array.isArray(input) || input.length > 32 || input.some(m => !m || !Number.isSafeInteger(m.id) || m.id < 1 || typeof m.from !== 'string' || !Number.isSafeInteger(m.portions) || m.portions < 1 || m.portions > 10 || !Number.isFinite(m.at) || (m.kind === 'seed' ? !m || !Object.hasOwn(TERRARIUM_PLANT_REQUIREMENTS, m.species) : !m || m.kind !== 'fruit' || !Object.hasOwn(TERRARIUM_CROPS, m.species)))) throw new Error('Invalid neighbor mailbox');
  const fresh = (input as NeighborMail[]).filter(m => m.id > (state.neighborCursor ?? 0)).sort((a,b) => a.id-b.id);
  const produce = { ...state.produce }, packets = { ...state.seedPackets };
  for (const mail of fresh) {
    if (mail.kind === 'fruit') { const species = mail.species as CropSpecies; produce[species] = Math.min(10000, (produce[species] ?? 0) + mail.portions); }
    else packets[mail.species] = Math.min(10000, (packets[mail.species] ?? 0) + mail.portions);
  }
  state.produce = produce; state.seedPackets = packets;
  if (fresh.length) state.neighborCursor = fresh[fresh.length-1].id;
  return state.neighborCursor ?? 0;
}
