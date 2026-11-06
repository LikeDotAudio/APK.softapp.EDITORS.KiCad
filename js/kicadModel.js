// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

const q = (s) => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export class KiCadModel {
  constructor(initialData = null) {
    this.id = initialData?.id || `kicad_${Date.now()}`;
    this.projectName = initialData?.projectName || 'AudioMatrix_Breakout';

    this.components = initialData?.components || [
      {
        ref: 'U1',
        value: 'OPA1612',
        footprint: 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm',
        description: 'Dual Ultra-Low Distortion Audio Op-Amp',
        pins: [
          { number: '1', name: 'OUT_A', net: 'AUDIO_CH1_HOT' },
          { number: '2', name: 'IN_A-', net: 'FEEDBACK_A' },
          { number: '3', name: 'IN_A+', net: 'LINE_IN_1' },
          { number: '4', name: 'VEE', net: 'GND_AUDIO' },
          { number: '5', name: 'IN_B+', net: 'LINE_IN_2' },
          { number: '6', name: 'IN_B-', net: 'FEEDBACK_B' },
          { number: '7', name: 'OUT_B', net: 'AUDIO_CH2_HOT' },
          { number: '8', name: 'VCC', net: '+15V_ANALOG' },
        ],
      },
      {
        ref: 'J1',
        value: 'Neutrik_NC3FAAH',
        footprint: 'Connector_Audio:Neutrik_NC3FAAH_Horizontal',
        description: '3-Pin Female XLR Audio Receptacle',
        pins: [
          { number: '1', name: 'CHASSIS_GND', net: 'CHASSIS_EARTH' },
          { number: '2', name: 'HOT', net: 'LINE_IN_1' },
          { number: '3', name: 'COLD', net: 'GND_AUDIO' },
        ],
      },
      {
        ref: 'J2',
        value: 'RJ45_EtherCON',
        footprint: 'Connector_RJ:Neutrik_NE8FAH_Horizontal',
        description: 'Dante / AES67 Gigabit Ethernet Port',
        pins: [
          { number: '1', name: 'TRD0+', net: 'DANTE_TX_P' },
          { number: '2', name: 'TRD0-', net: 'DANTE_TX_N' },
          { number: '3', name: 'TRD1+', net: 'DANTE_RX_P' },
          { number: '4', name: 'TRD2+', net: 'POE_V+' },
          { number: '5', name: 'TRD2-', net: 'POE_V+' },
          { number: '6', name: 'TRD1-', net: 'DANTE_RX_N' },
          { number: '7', name: 'TRD3+', net: 'POE_V-' },
          { number: '8', name: 'TRD3-', net: 'POE_V-' },
        ],
      },
    ];

    this.selectedComponentRef = null;
    this._compCounter = this.components.length + 1;
  }

  addComponent(comp) {
    const ref = comp.ref || `U${this._compCounter++}`;
    const newComp = {
      ref,
      value: comp.value || 'Generic_Device',
      footprint: comp.footprint || 'Package_DIP:DIP-8_W7.62mm',
      description: comp.description || 'Schematic Device Block',
      pins: comp.pins || [
        { number: '1', name: 'IN+', net: 'NET_1' },
        { number: '2', name: 'OUT+', net: 'NET_2' },
        { number: '3', name: 'GND', net: 'GND' },
      ],
    };
    if (comp.bimId) newComp.bimId = comp.bimId; // the BIM part it is an occurrence of (its .ifc type on Save Model)
    this.components.push(newComp);
    return newComp;
  }

  updateComponent(ref, updates) {
    const comp = this.components.find((c) => c.ref === ref);
    if (!comp) return null;
    Object.assign(comp, updates);
    return comp;
  }

  deleteComponent(ref) {
    const idx = this.components.findIndex((c) => c.ref === ref);
    if (idx !== -1) {
      this.components.splice(idx, 1);
      if (this.selectedComponentRef === ref) this.selectedComponentRef = null;
      return true;
    }
    return false;
  }

  buildNetMap() {
    const netMap = new Map();
    for (const comp of this.components) {
      for (const pin of comp.pins) {
        if (!pin.net) continue;
        if (!netMap.has(pin.net)) {
          netMap.set(pin.net, []);
        }
        netMap.get(pin.net).push({
          ref: comp.ref,
          pin: pin.number,
          pinName: pin.name,
        });
      }
    }
    return netMap;
  }

  generateKiCadNetlist() {
    const netMap = this.buildNetMap();
    const dateStr = new Date().toISOString();

    const compsSexpr = this.components.map((c) => `
    (comp (ref ${q(c.ref)})
      (value ${q(c.value)})
      (footprint ${q(c.footprint)})
      (datasheet "http://APK.audio")
      (fields
        (field (name "Description") ${q(c.description)})
        (field (name "Vendor") "APK.audio")
      )
    )`).join('\n');

    let netCode = 1;
    const netsSexpr = Array.from(netMap.entries()).map(([netName, nodes]) => {
      const nodesSexpr = nodes.map((n) => `      (node (ref ${q(n.ref)}) (pin ${q(n.pin)}))`).join('\n');
      return `    (net (code ${netCode++}) (name ${q(netName)})\n${nodesSexpr}\n    )`;
    }).join('\n');

    return `(export (version "E")
  (design
    (source ${q(this.projectName)})
    (date ${q(dateStr)})
    (tool "APK.audio KiCad Netlist Generator")
    (sheet (number "1") (name "/") (tstamps "/"))
  )
  (components
${compsSexpr}
  )
  (nets
${netsSexpr}
  )
)`;
  }

  toJSON() {
    return {
      type: 'kicad',
      id: this.id,
      projectName: this.projectName,
      components: this.components,
    };
  }
}
