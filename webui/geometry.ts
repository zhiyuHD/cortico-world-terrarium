export function plotPosition(x: number, y: number, size = 5): { x: number; y: number } {
  return size === 5 ? { x: 260 + x * 70, y: 290 + y * 9 } : { x: 160 + x * 480 / (size - 1), y: 280 + y * 60 / (size - 1) };
}
