export function drawAntNest(g: CanvasRenderingContext2D, x: number, y: number, night: boolean): void {
  g.save();
  g.fillStyle = 'rgba(35,25,18,.2)';
  g.beginPath(); g.ellipse(x + 2, y + 5, 24, 6, 0, 0, Math.PI * 2); g.fill();
  const mound = g.createLinearGradient(0, y - 9, 0, y + 6);
  mound.addColorStop(0, night ? '#a08b67' : '#dfbf87');
  mound.addColorStop(1, night ? '#67543b' : '#aa7e4e');
  g.fillStyle = mound;
  g.beginPath(); g.moveTo(x - 23, y + 2);
  g.bezierCurveTo(x - 16, y, x - 14, y - 9, x - 3, y - 8);
  g.bezierCurveTo(x + 10, y - 10, x + 16, y - 1, x + 23, y + 3);
  g.bezierCurveTo(x + 12, y + 9, x - 16, y + 8, x - 23, y + 2); g.fill();
  g.strokeStyle = night ? '#b09a72' : '#f0d49b'; g.lineWidth = 1.5;
  g.beginPath(); g.ellipse(x - 1, y - 1, 10, 4.5, -.1, 0, Math.PI * 2); g.stroke();
  g.fillStyle = night ? '#1c1b18' : '#30251e';
  g.beginPath(); g.ellipse(x - 1, y, 8.5, 3.5, -.1, 0, Math.PI * 2); g.fill();
  for (let pebble = 0; pebble < 9; pebble++) {
    const angle = pebble * 2.4;
    g.fillStyle = pebble % 2 ? (night ? '#7f6b4e' : '#b48955') : (night ? '#af966d' : '#edce91');
    g.beginPath(); g.ellipse(x + Math.cos(angle) * (13 + pebble % 3 * 2), y + 2 + Math.sin(angle) * 3.5, 1.5, .9, angle, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
