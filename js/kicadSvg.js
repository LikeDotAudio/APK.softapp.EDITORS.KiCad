// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

export function renderKiCadSchematicSvg(model, options = {}) {
  const { selectedComponentRef = null } = options;

  const compWidth = 200;
  const pinRowHeight = 22;
  const gapX = 40;
  const startX = 30;
  const startY = 30;

  let currentX = startX;
  let maxHeight = 300;

  const componentsSvg = model.components.map((comp) => {
    const isSelected = comp.ref === selectedComponentRef;
    const bodyHeight = 50 + comp.pins.length * pinRowHeight;
    maxHeight = Math.max(maxHeight, bodyHeight + 60);
    const x = currentX;
    const y = startY;
    currentX += compWidth + gapX;

    const pinsSvg = comp.pins.map((pin, pIdx) => {
      const py = y + 45 + pIdx * pinRowHeight;
      return `
        <g class="kicad-pin" transform="translate(${x}, ${py})">
          <line x1="0" y1="10" x2="-15" y2="10" stroke="#4A9EFF" stroke-width="1.5"/>
          <circle cx="-15" cy="10" r="2" fill="#4A9EFF"/>
          <text x="-20" y="13" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="9" fill="#888888">${pin.number}</text>
          
          <rect x="10" y="1" width="${compWidth - 20}" height="18" rx="2" fill="#121212" stroke="#2c2c2c" stroke-width="0.75"/>
          <text x="16" y="13" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="600" fill="#f4f4f5">${pin.name}</text>
          <text x="${compWidth - 16}" y="13" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="9" fill="#F4902C">${pin.net || '~'}</text>
        </g>
      `;
    }).join('');

    return `
      <g class="kicad-comp-card" data-comp-ref="${comp.ref}" style="cursor: pointer;">
        <!-- IC Body Outline -->
        <rect x="${x}" y="${y}" width="${compWidth}" height="${bodyHeight}" rx="4"
          fill="${isSelected ? '#2c2c2c' : '#18181b'}"
          stroke="${isSelected ? '#F4902C' : '#4A9EFF'}"
          stroke-width="${isSelected ? 2.5 : 1.5}"
          filter="drop-shadow(0 4px 8px rgba(0,0,0,0.5))"
        />
        <!-- Header -->
        <rect x="${x}" y="${y}" width="${compWidth}" height="32" rx="4" fill="#0f0f11"/>
        <text x="${x + 12}" y="${y + 20}" font-family="'JetBrains Mono', monospace" font-size="13" font-weight="700" fill="#F4902C">${comp.ref}</text>
        <text x="${x + compWidth - 12}" y="${y + 20}" text-anchor="end" font-family="-apple-system, sans-serif" font-size="11" font-weight="600" fill="#f4f4f5">${comp.value}</text>
        ${pinsSvg}
      </g>
    `;
  }).join('');

  const totalWidth = Math.max(800, currentX + 40);

  return `
    <svg id="kicad-canvas-svg" width="${totalWidth}" height="${maxHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#121212"/>
      ${componentsSvg}
    </svg>
  `;
}
