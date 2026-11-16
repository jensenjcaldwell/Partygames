// Native vector props stay crisp on both a phone and a large TV.
export function robotArt(number = 1) {
  const eye = number % 3 === 0
    ? '<path d="M29 41h13m16 0h13" stroke="#b4fff0" stroke-width="6"/>'
    : '<circle cx="35" cy="41" r="6" fill="#b4fff0"/><circle cx="65" cy="41" r="6" fill="#b4fff0"/><circle cx="36" cy="42" r="2" fill="#142824"/><circle cx="66" cy="42" r="2" fill="#142824"/>';
  return `<svg viewBox="0 0 100 100" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="50" cy="90" rx="36" ry="6" fill="#000" opacity=".35"/>
    <g stroke="#191f21" stroke-width="4" stroke-linejoin="round">
      <path d="M16 59L8 64l3 17 12-5m61-17 8 5-3 17-12-5" fill="#b9956b"/>
      <rect x="23" y="72" width="18" height="18" rx="5" fill="#3c4b4e"/><rect x="59" y="72" width="18" height="18" rx="5" fill="#3c4b4e"/>
      <path d="M48 23l-3-13h15" fill="none"/><circle cx="62" cy="10" r="5" fill="#ffb547"/>
      <path d="M24 51h52l5 28H19z" fill="var(--bot-color, #ffb547)"/>
      <path d="M20 27l58-4 5 35-63 3z" fill="var(--bot-color, #ffb547)"/>
      <rect x="25" y="31" width="51" height="21" rx="8" fill="#263d3b"/>
      <path d="M35 67h30m-30 7h20" stroke="#694d32" stroke-width="3"/>
      <path d="M25 25l9-1m40 30 7-1" stroke="#fff0c9" stroke-width="3"/>
      <path d="M20 80h60" stroke="#694d32" stroke-width="3"/>
    </g>${eye}<circle cx="27" cy="59" r="2" fill="#fff0c9"/><circle cx="73" cy="57" r="2" fill="#fff0c9"/>
  </svg>`;
}

export function artElement(h, number, color, className = 'bb-art') {
  const el = h(`div.${className}`, { style: { '--bot-color': color } });
  el.innerHTML = robotArt(number);
  return el;
}

export function emitterArt() {
  return `<svg viewBox="0 0 110 70" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <g stroke="#131c20" stroke-width="5" stroke-linejoin="round">
      <rect x="4" y="9" width="65" height="52" rx="10" fill="#a65743"/>
      <path d="M13 14h13l-10 17H7m39-17h13L29 58H16" fill="#ffce72" stroke="none"/>
      <rect x="40" y="21" width="44" height="28" rx="5" fill="#37474a"/>
      <rect x="73" y="17" width="15" height="36" rx="4" fill="var(--emitter-light, #ff725d)"/>
      <path d="M92 24l15 11-15 11" fill="var(--emitter-light, #ff725d)"/>
    </g><circle cx="15" cy="49" r="4" fill="#172326"/>
  </svg>`;
}
