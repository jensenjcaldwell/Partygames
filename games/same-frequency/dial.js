const NS = 'http://www.w3.org/2000/svg';
const polar = (n, r) => {
  const a = Math.PI * (1 - n / 100);
  return [400 + Math.cos(a) * r, 320 - Math.sin(a) * r];
};
function svgElement(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function arc(from, to, r, color, width, cls = '') {
  const [x, y] = polar(Math.max(0, from), r);
  const [xx, yy] = polar(Math.min(100, to), r);
  return svgElement('path', { d: `M ${x} ${y} A ${r} ${r} 0 0 1 ${xx} ${yy}`, stroke: color, 'stroke-width': width, fill: 'none', class: cls });
}

export function dial({ target, markers = [], value, demo = false } = {}) {
  const svg = svgElement('svg', { viewBox: '0 0 800 380', class: 'sf-dial', role: 'img',
    'aria-label': target === undefined ? 'Spectrum dial. Target hidden.' : `Spectrum dial. Target ${target} out of 100.` });
  svg.append(arc(0, 100, 253, '#ddd4c0', 126));
  svg.append(arc(0, 50, 253, '#cbd6c8', 118), arc(50, 100, 253, '#edbb83', 118));
  for (let n = 0; n <= 100; n += 2) {
    const [x, y] = polar(n, 322), [xx, yy] = polar(n, n % 10 === 0 ? 304 : 314);
    svg.append(svgElement('line', { x1: x, y1: y, x2: xx, y2: yy, stroke: '#263b3e', 'stroke-width': n % 10 === 0 ? 3 : 1.5 }));
  }
  if (target !== undefined) {
    const group = svgElement('g', { class: demo ? 'sf-demo-target' : 'sf-target' });
    group.append(arc(target - 25, target + 25, 253, '#d4aa58', 118),
      arc(target - 15, target + 15, 253, '#d77a43', 118),
      arc(target - 10, target + 10, 253, '#b94f32', 118),
      arc(target - 5, target + 5, 253, '#234d4a', 118));
    const [x, y] = polar(target, 326), [xx, yy] = polar(target, 182);
    group.append(svgElement('line', { x1: x, y1: y, x2: xx, y2: yy, stroke: '#fff5dd', 'stroke-width': 4 }));
    svg.append(group);
  }
  for (const [i, marker] of markers.entries()) {
    const radius = 233 + (i % 3) * 23;
    const [x, y] = polar(marker.guess, radius);
    const g = svgElement('g', { class: 'sf-marker', style: `animation-delay:${i * 45}ms` });
    const [xx, yy] = polar(marker.guess, 185);
    g.append(svgElement('line', { x1: 400, y1: 320, x2: xx, y2: yy, stroke: marker.color || '#263b3e', 'stroke-width': 3, opacity: '.8' }),
      svgElement('circle', { cx: x, cy: y, r: 14, fill: marker.color || '#263b3e', stroke: '#263b3e', 'stroke-width': 3 }));
    svg.append(g);
  }
  if (value !== undefined) {
    const needle = svgElement('g', { class: 'sf-needle', transform: `rotate(${value * 1.8 - 90} 400 320)` });
    needle.append(svgElement('path', { d: 'M 394 320 L 400 75 L 406 320 Z', fill: '#b94f32' }));
    svg.append(needle);
  }
  svg.append(svgElement('circle', { cx: 400, cy: 320, r: 31, fill: '#263b3e' }),
    svgElement('circle', { cx: 400, cy: 320, r: 20, fill: '#f6efd9' }),
    svgElement('circle', { cx: 400, cy: 320, r: 6, fill: '#b94f32' }));
  return svg;
}

export function waves(h) {
  return h('div.sf-waves', { 'aria-hidden': 'true' }, Array.from({ length: 17 }, (_, i) =>
    h('i', { style: { '--i': i, '--height': `${10 + Math.sin(i * .85) ** 2 * 28}px` } })));
}
