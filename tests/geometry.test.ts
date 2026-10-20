import { expect, it } from 'vitest';
import { cellPosition, LAND_SURFACE, WATER_SURFACE, residentScale } from '../webui/geometry.ts';
import { TERRARIUM_LEVELS } from '../src/progression.ts';

it('fits every cell and scaled resident inside the visible surface at every expansion level', () => {
  for (const { size } of TERRARIUM_LEVELS) for (const surface of [LAND_SURFACE, WATER_SURFACE]) {
    const width = surface.width / size, height = surface.height / size;
    const centers = new Set<string>();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const p = cellPosition(surface, x, y, size);
      centers.add(`${p.x},${p.y}`);
      expect(p.x - width / 2).toBeGreaterThanOrEqual(surface.x - 1e-9);
      expect(p.x + width / 2).toBeLessThanOrEqual(surface.x + surface.width + 1e-9);
      expect(p.y - height / 2).toBeGreaterThanOrEqual(surface.y - 1e-9);
      expect(p.y + height / 2).toBeLessThanOrEqual(surface.y + surface.height + 1e-9);
      expect(p.x - 35 * residentScale(size)).toBeGreaterThan(surface.x);
      expect(p.x + 35 * residentScale(size)).toBeLessThan(surface.x + surface.width);
    }
    expect(centers.size).toBe(size ** 2);
  }
});
