import type { ToolDef } from 'cortico/core/types.ts';
import type { TerrariumWorld } from '../src/world.ts';
import { TERRARIUM_TOOL_GROUPS } from '../src/tool-groups.ts';
/** Existing behavior fixtures invoke the public grouped tool through their operation name. */
export function operationTools(world: TerrariumWorld): ToolDef[] {
  return world.tools().flatMap(tool => TERRARIUM_TOOL_GROUPS[tool.name].map(operation => ({ ...tool, name: `terrarium_${operation}`, handler: (args, context) => tool.handler(TERRARIUM_TOOL_GROUPS[tool.name].length === 1 && tool.name === `terrarium_${operation}` ? args : { ...args, operation }, context) })));
}
