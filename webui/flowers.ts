import { flowerStage } from '../src/habitat.ts';

type FlowerPlant = Parameters<typeof flowerStage>[0];

/** Shared flower geometry for live scenes and recorded frames. */
export function drawPlantFlowers(g: CanvasRenderingContext2D, plant: FlowerPlant, x: number, y: number, night: boolean): void {
  const stage = flowerStage(plant);
  if (!stage) return;
  g.save(); g.translate(x, y); g.lineCap = 'round';
  const stem = (tx: number, ty: number): void => {
    g.strokeStyle = '#568451'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 8); g.quadraticCurveTo(tx * .35, ty * .6, tx, ty); g.stroke();
  };
  const petal = (px: number, py: number, rx: number, ry: number, angle: number, color: string): void => {
    g.fillStyle = color; g.beginPath(); g.ellipse(px, py, rx, ry, angle, 0, Math.PI * 2); g.fill();
  };
  const bud = (px: number, py: number, color: string): void => {
    petal(px, py, 4, 7, -.15, color);
    g.fillStyle = '#5f965a'; g.beginPath(); g.moveTo(px - 5, py + 3); g.lineTo(px, py + 7); g.lineTo(px + 5, py + 2); g.lineTo(px, py + 4); g.fill();
  };
  if (plant.species === 'clover') {
    for (const [tx, ty, scale] of [[-16, -19, .8], [11, -34, 1], [29, -9, .7]]) {
      stem(tx, ty + 8); g.save(); g.translate(tx, ty); g.scale(scale, scale);
      if (stage === 'bud' || night) bud(0, 0, '#d49cb4');
      else {
        petal(0, 2, 13, 11, 0, '#c47b9a');
        for (let ring = 0; ring < 3; ring++) {
          const count = 12 - ring * 3, radius = 9 - ring * 3;
          for (let i = 0; i < count; i++) {
            const angle = i * Math.PI * 2 / count + ring * .4;
            petal(Math.cos(angle) * radius, Math.sin(angle) * radius * .8, 2.6, 5, angle + Math.PI / 2, ['#edb4c8', '#f7cfda', '#fff0e9'][ring]);
          }
        }
      }
      g.restore();
    }
  } else if (plant.species === 'basil') {
    stem(0, -49);
    for (let level = 0; level < 5; level++) for (const side of [-1, 1]) {
      const px = side * (8 - level), py = -7 - level * 9;
      stem(px, py + 2);
      if (stage === 'bud' || night) bud(px, py, '#b7a8ce');
      else {
        petal(px, py, 5, 4, side * .6, '#c8b5de');
        petal(px + side * 2, py + 2, 5, 3, -side * .25, '#f8efff');
        petal(px - side, py - 2, 3, 4, side * .3, '#eee4f7');
        petal(px + side * 3, py + 1, 1.5, 1.5, 0, '#d3a56b');
      }
    }
    bud(0, -51, '#c3b7d4');
  } else {
    for (const [tx, ty] of [[-15, -18], [20, -32], [31, -5]]) {
      stem(tx, ty + 6);
      if (stage === 'bud' || night) bud(tx, ty, '#d69ab1');
      else {
        petal(tx, ty - 4, 12, 10, -.15, '#d88fac');
        petal(tx, ty - 7, 9, 7, -.15, '#f7cbd9');
        petal(tx - 7, ty + 3, 9, 5, .6, '#e9a6c0');
        petal(tx + 7, ty + 3, 9, 5, -.6, '#f0b7ce');
        petal(tx + 1, ty + 5, 5, 6, -.2, '#fff0e9');
        petal(tx + 1, ty + 2, 2, 2, 0, '#d6ab65');
      }
    }
  }
  g.restore();
}
