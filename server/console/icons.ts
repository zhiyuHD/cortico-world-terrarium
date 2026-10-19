export type IconName = 'sprout' | 'boxes' | 'message-square' | 'sliders-horizontal' | 'megaphone' | 'shield-check' | 'sun-moon' | 'log-out' | 'refresh-cw' | 'list-checks' | 'list-x' | 'send' | 'filter' | 'power' | 'power-off' | 'calendar-clock' | 'calendar-x' | 'eye' | 'globe' | 'crosshair' | 'check' | 'x' | 'wifi' | 'wifi-off' | 'circle-check' | 'circle-minus' | 'reply' | 'undo-2' | 'clock' | 'arrow-right';

export function icon(name: IconName): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(namespace, 'use');
  use.setAttribute('href', `${new URL('./assets/icons.svg', import.meta.url).href}#${name}`);
  svg.append(use);
  return svg;
}

export function mountIcons(): void {
  for (const placeholder of Array.from(document.querySelectorAll<HTMLElement>('[data-icon]'))) {
    placeholder.replaceWith(icon(placeholder.dataset.icon as IconName));
  }
}
