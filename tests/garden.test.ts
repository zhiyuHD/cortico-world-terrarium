import { expect, it } from 'vitest';
import { newState, sow, releaseBug, advance, validState, migrateState } from '../src/state.ts';
import { newAquarium, stockFish, plantAquatic, validAquarium, advanceAquarium } from '../src/aquarium.ts';
import { harvest, sellProduce, transplant, cropRounds, actDecomposer, addLitter } from '../src/garden.ts';
import { receiveNeighborMail } from '../src/neighbors.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { TerrariumWorld, TERRARIUM_TOOL_DECLS, TERRARIUM_AQUATIC_TOOL_DECLS } from '../src/world.ts';
import { TERRARIUM_FORUM_TOOL_DECLS } from '../src/forum.ts';
import { TERRARIUM_TOOL_GROUPS } from '../src/tool-groups.ts';
import { fertilizePlot } from '../src/compost.ts';
const now = Date.UTC(2026, 9, 26, 8);
function garden() { const s = newState(now); s.plants = []; s.history = []; return s; }
function tomato(s = garden()) { const p = { id: 'crop', species: 'tomato' as const, x: 4, y: 4, moisture: 50, health: 100, dry: false, stage: 3, growthHours: 100, fruitGrowthHours: 42 }; s.plants.push(p); return { s, p }; }
it('harvests repeat crops with a three-round cap, consumes pollen and sells only owned fruit', () => {
  const { s, p } = tomato(); p.fruitGrowthHours = 90; Object.assign(p, { pollination: 2 });
  expect(harvest(s, p.id)).toMatchObject({ portions: 11 });
  expect(() => harvest(s,p.id)).toThrow('No ripe');
  expect(() => sellProduce(s,'tomato',12)).toThrow('Not enough');
  expect(sellProduce(s,'tomato',11)).toMatchObject({ coins: 33 });
  expect(validState(s)).toBe(true); expect(migrateState(structuredClone(s))).toEqual(s);
});
it('fertilizer changes growth appearance without creating ripe fruit or sale credit', () => {
  const s = garden(); s.progression = { level: 2, peakScore: 120, guideStep: 0, guideSkipped: false, actions: [] };
  s.soil = Array.from({length:36},(_,i)=>({x:i%6,y:Math.floor(i/6),moisture:50}));
  s.facilities = [{kind:'compost_bin',x:0,y:0,enabled:true}];s.fertilizer=20;
  const seed=sow(s,'tomato',4,4); fertilizePlot(s,4,4,20);
  expect(s.plants[0].growthHours).toBeGreaterThan(18); expect(cropRounds(s.plants[0])).toBe(0);
  expect(()=>harvest(s,seed.id)).toThrow('No ripe'); expect(validState(s)).toBe(true);
});
it('transplants without resetting crop progress and leaves pots on their plots', () => {
  const {s,p}=tomato();s.economy={earned:24,spent:24,inventory:{},pots:[{kind:'clay',x:4,y:4}]};
  transplant(s,p.id,2,2);expect(p).toMatchObject({x:2,y:2,growthHours:100,fruitGrowthHours:42});
  expect(s.economy.pots[0]).toMatchObject({x:4,y:4});
  sow(s,'strawberry',3,3);expect(()=>transplant(s,p.id,3,3)).toThrow('occupied');expect(validState(s)).toBe(true);
});
it('decomposes litter into fertilizer without damaging living plants', () => {
  const s=garden();s.progression={level:2,peakScore:120,guideStep:0,guideSkipped:false,actions:[]};
  s.soil=Array.from({length:36},(_,i)=>({x:i%6,y:Math.floor(i/6),moisture:50}));s.facilities=[{kind:'compost_bin',x:0,y:0,enabled:true}];
  const bug=releaseBug(s,'woodlouse',2,2);addLitter(s,2,2,3);
  for(let i=0;i<3;i++){bug.energy=30;actDecomposer(s,bug);}expect(s.fertilizer).toBe(1);expect(s.litter).toEqual([]);expect(validState(s)).toBe(true);
});
it('prevents queen eggs when breeding is disabled and when colony population reaches its cap', () => {
  for(const policy of [{breedingEnabled:false,maxPopulation:12},{breedingEnabled:true,maxPopulation:1}]){
    const s=garden();const queen=releaseBug(s,'ant',0,0);queen.ageHours=8.99;queen.energy=100;queen.role='queen';queen.inside={nestId:'nest',x:2,y:2};
    s.nests=[{id:'nest',x:0,y:0,depth:5,food:90}];s.antPolicy={...policy,protectPlantsWhenFed:true};advance(s,now+60_000,'UTC');
    expect(s.eggs??[]).toHaveLength(0);expect(validState(s)).toBe(true);
  }
});
it('receives mailbox rewards exactly once and uses gifted seed packets at sowing', () => {
  const s=garden(), mail=[{id:8,from:'neighbor',kind:'seed',species:'tomato',portions:1,at:now},{id:9,from:'neighbor',kind:'fruit',species:'strawberry',portions:1,at:now}];
  expect(receiveNeighborMail(s,mail)).toBe(9);receiveNeighborMail(s,mail);expect(s.produce).toEqual({strawberry:1});expect(s.seedPackets).toEqual({tomato:1});
  expect(sow(s,'tomato',1,1).ageHours).toBe(1);expect(sow(s,'tomato',2,1).ageHours).toBe(0);expect(validState(s)).toBe(true);
  const before=structuredClone(s);expect(()=>receiveNeighborMail(s,[...mail,{id:10,kind:'fruit',species:'fake',portions:1,at:now,from:'x'}])).toThrow('Invalid');expect(s).toEqual(before);
});
it('supports new aquatic residents and plants through simulation and save validation', () => {
  const s=newAquarium(now);for(const species of ['medaka','shrimp','aquatic_snail'])stockFish(s,species,2,2);
  plantAquatic(s,'vallisneria',1,1);plantAquatic(s,'java_moss',2,2);transplant(s,s.plants[2].id,3,3);
  advanceAquarium(s,now+600_000,'UTC');expect(validAquarium(s)).toBe(true);expect(s.fish).toHaveLength(3);
});
it('exposes fourteen compact tools while preserving every prior operation', () => {
  const w=new TerrariumWorld({cfg:{...TERRARIUM_DEFAULTS,leaderboardUrl:''},timezone:'UTC',stateFile:'/unused/state.json'}), tools=w.tools();
  expect(tools).toHaveLength(14);expect(tools.map(t=>t.name)).toContain('terrarium_garden');expect(tools.map(t=>t.name)).not.toContain('terrarium_sow');
  const operations=new Set(Object.values(TERRARIUM_TOOL_GROUPS).flat().map(op=>`terrarium_${op}`));
  for(const tool of [...TERRARIUM_TOOL_DECLS,...TERRARIUM_AQUATIC_TOOL_DECLS,...TERRARIUM_FORUM_TOOL_DECLS])expect(operations.has(tool.name),tool.name).toBe(true);
  const old=JSON.stringify([...TERRARIUM_TOOL_DECLS,...TERRARIUM_AQUATIC_TOOL_DECLS,...TERRARIUM_FORUM_TOOL_DECLS]).length;
  const reduced=JSON.stringify(tools).length;expect(reduced).toBeLessThan(old*.8);
});
