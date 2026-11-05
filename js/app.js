// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { linkBlock, mountDiscovered } from './softappLink.js';
import { KiCadModel } from './kicadModel.js';
import { renderKiCadSchematicSvg } from './kicadSvg.js';

let model = new KiCadModel();
let activeTab = 'schematic'; // 'schematic' | 'netlist'

const S = window.APKSoftapp;
const esc = S.esc;

const bridge = linkBlock(S, {
  editor: 'KiCad Netlist Generator',
  blockType: 'kicad',
  Model: KiCadModel,
  getModel: () => model,
  setModel: (m, meta) => {
    model = m;
    const tag = document.getElementById('block-tag');
    if (tag && (meta.blockName || meta.filename)) tag.textContent = meta.blockName || meta.filename;
    renderAll();
  },
  filename: (m) => m.projectName.toLowerCase(),
});

function renderInspector() {
  const container = document.getElementById('inspector-content');
  if (!container) return;

  if (model.selectedComponentRef) {
    const comp = model.components.find((c) => c.ref === model.selectedComponentRef);
    if (!comp) {
      model.selectedComponentRef = null;
      renderInspector();
      return;
    }

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid var(--osc-border-default); padding-bottom: 8px;">
        <span style="font-weight: 700; color: var(--osc-text-primary); font-size: 13px;">${esc(comp.ref)} — ${esc(comp.value)}</span>
        <button class="btn btn-secondary btn-sm" id="btn-delete-comp" style="color: var(--osc-status-danger);">🗑️ Delete</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">REFERENCE DESIGNATION</label>
          <input type="text" class="input" id="inp-ref" value="${esc(comp.ref)}">
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">VALUE / PART NUMBER</label>
          <input type="text" class="input" id="inp-val" value="${esc(comp.value)}">
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">KICAD FOOTPRINT</label>
          <input type="text" class="input" id="inp-footprint" value="${esc(comp.footprint)}">
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">DESCRIPTION</label>
          <input type="text" class="input" id="inp-desc" value="${esc(comp.description)}">
        </div>

        <div style="margin-top: 6px;">
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 4px;">PINS & NET CONNECTIONS</label>
          <div id="pins-table" style="max-height: 260px; overflow-y: auto;"></div>
        </div>
      </div>
    `;

    document.getElementById('btn-delete-comp')?.addEventListener('click', () => {
      model.deleteComponent(comp.ref);
      bridge.changed();
      renderAll();
    });

    document.getElementById('inp-ref')?.addEventListener('input', (e) => {
      comp.ref = e.target.value;
      bridge.changed();
      renderView();
    });

    document.getElementById('inp-val')?.addEventListener('input', (e) => {
      comp.value = e.target.value;
      bridge.changed();
      renderView();
    });

    document.getElementById('inp-footprint')?.addEventListener('input', (e) => {
      comp.footprint = e.target.value;
      bridge.changed();
      renderView();
    });

    document.getElementById('inp-desc')?.addEventListener('input', (e) => {
      comp.description = e.target.value;
      bridge.changed();
    });

    renderPinTable(comp);

  } else {
    container.innerHTML = `
      <div style="padding: 20px 10px; text-align: center; color: var(--osc-text-muted);">
        <div style="font-size: 28px; margin-bottom: 8px; opacity: 0.5;">🔌</div>
        <div>Select a component block to inspect and modify pins, footprints, and net connections.</div>
      </div>
    `;
  }
}

/* The pins are an APKTable (vendor/apk-table): APKTable.get('kicad-pins'). */
function renderPinTable(comp) {
  const tableHost = document.getElementById('pins-table');
  if (!tableHost || !window.APKTable) return;
  window.APKTable.create(tableHost, {
    id: 'kicad-pins',
    columns: [
      { key: 'number', label: 'Pin', mono: true },
      { key: 'name', label: 'Name', mono: true },
      { key: 'net', label: 'Net', mono: true, placeholder: 'Net…' },
    ],
    rows: comp.pins,
    empty: 'No pins.',
    toolbar: false,
    onEdit: (i, key, value) => {
      if (!comp.pins[i]) return;
      comp.pins[i][key] = value;
      bridge.changed();
      renderView();
      renderHeaderStats();
    },
    onDelete: (i) => {
      comp.pins.splice(i, 1);
      bridge.changed();
      renderAll();
    },
  });
}

function renderView() {
  const canvasWrap = document.getElementById('canvas-wrapper');
  const netlistWrap = document.getElementById('netlist-preview-wrapper');

  if (activeTab === 'schematic') {
    canvasWrap.style.display = 'flex';
    netlistWrap.style.display = 'none';

    canvasWrap.innerHTML = renderKiCadSchematicSvg(model, {
      selectedComponentRef: model.selectedComponentRef,
    });

    const svg = canvasWrap.querySelector('#kicad-canvas-svg');
    if (!svg) return;

    svg.querySelectorAll('.kicad-comp-card').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const ref = el.getAttribute('data-comp-ref');
        model.selectedComponentRef = ref;
        renderAll();
      });
    });

    svg.addEventListener('click', () => {
      model.selectedComponentRef = null;
      renderAll();
    });

  } else {
    canvasWrap.style.display = 'none';
    netlistWrap.style.display = 'block';

    const netlistText = model.generateKiCadNetlist();
    document.getElementById('netlist-pre').textContent = netlistText;
  }
}

function renderHeaderStats() {
  const container = document.getElementById('telemetry-metrics');
  if (!container) return;

  const netMap = model.buildNetMap();
  container.innerHTML = `
    <div style="display: flex; align-items: center; gap: 14px; font-size: 10px; color: var(--osc-text-muted);">
      <span>COMPONENTS: <strong style="color: var(--osc-text-primary);">${esc(model.components.length)}</strong></span>
      <span>NETWORKS: <strong style="color: var(--osc-accent-primary);">${netMap.size}</strong></span>
      <span>FORMAT: <strong style="color: var(--osc-accent-secondary);">KiCad Eeschema (v7/v8)</strong></span>
    </div>
  `;
}

function renderAll() {
  renderView();
  renderInspector();
  renderHeaderStats();
}

document.addEventListener('DOMContentLoaded', () => {
  S.describe({
    name: 'KiCad Netlist Generator',
    does: 'Edits schematic components, their pins and nets, and writes them out as a KiCad Eeschema netlist.',
    inputs: [
      { name: 'KiCad block', from: 'the CAD block this editor was opened on (host@1 load)', kind: 'cad' },
      { name: 'Block file', from: '.json picked with Open Block', kind: 'file' },
      { name: 'Discovered things', from: 'APKSoftapp.discovered() on the bus, filtered by config/discovered.json kinds', kind: 'bus' },
    ],
    outputs: [
      { name: 'KiCad block', to: 'the CAD drawing on Save & Return, or a .json download standalone', kind: 'cad' },
      { name: 'Live edits', to: 'the CAD after every change (blockChanged)', kind: 'cad' },
      { name: 'Netlist', to: '<project>.net download (KiCad S-expression) from Download .net', kind: 'file' },
    ],
    controls: [
      { name: 'Schematic / Netlist tabs', how: 'switch between the IC block drawing and the S-expression preview' },
      { name: '➕ Add Component', how: 'adds a component and selects it' },
      { name: 'Click a component', how: 'inspect it: reference, value, footprint, description, pins and nets; 🗑️ deletes it' },
      { name: 'Pin table', how: 'edit pin number, name and net; the row × deletes the pin' },
      { name: '⚡ Discovered', how: 'show / hide what the bus knows' },
      { name: 'Save & Return / ✕', how: 'save into the CAD (or download) / close the editor' },
    ],
    problems: ['bad_json', 'bad_input', 'file_unreadable', 'bus_missing', 'not_in_cad'],
  });
  renderAll();

  document.getElementById('tab-schematic')?.addEventListener('click', () => {
    activeTab = 'schematic';
    document.getElementById('tab-schematic')?.classList.add('btn-primary');
    document.getElementById('tab-schematic')?.classList.remove('btn-secondary');
    document.getElementById('tab-netlist')?.classList.remove('btn-primary');
    document.getElementById('tab-netlist')?.classList.add('btn-secondary');
    renderAll();
  });

  document.getElementById('tab-netlist')?.addEventListener('click', () => {
    activeTab = 'netlist';
    document.getElementById('tab-netlist')?.classList.add('btn-primary');
    document.getElementById('tab-netlist')?.classList.remove('btn-secondary');
    document.getElementById('tab-schematic')?.classList.remove('btn-primary');
    document.getElementById('tab-schematic')?.classList.add('btn-secondary');
    renderAll();
  });

  document.getElementById('btn-add-comp')?.addEventListener('click', () => {
    const comp = model.addComponent({});
    model.selectedComponentRef = comp.ref;
    bridge.changed();
    renderAll();
  });

  document.getElementById('btn-download-netlist')?.addEventListener('click', () => {
    const netlist = model.generateKiCadNetlist();
    const blob = new Blob([netlist], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${model.projectName.toLowerCase()}.net`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('btn-open-block')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.net';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          bridge.openLocal(parsed, { filename: file.name });
        } catch (err) {
          S.showProblem(err.name === 'SyntaxError' ? 'bad_json' : 'bad_input', {
            subject: file.name, detail: err.message,
            fix: ['Open a KiCad block saved by this editor (.json, blockType kicad). A .net netlist is an output only: it cannot be opened back.'],
          });
        }
      };
      reader.onerror = () => S.showProblem('file_unreadable', { subject: file.name, detail: reader.error && reader.error.message });
      reader.readAsText(file);
    };
    input.click();
  });

  mountDiscovered(S, window.APKTable, {
    button: document.getElementById('btn-discovered'),
    panel: document.getElementById('discovered-panel'),
    status: document.getElementById('discovered-status'),
    tableHost: document.getElementById('discovered-table'),
    tableId: 'kicad-discovered',
  });

  document.getElementById('btn-save-block')?.addEventListener('click', () => {
    bridge.save();
  });

  document.getElementById('btn-close')?.addEventListener('click', () => {
    bridge.close();
  });
});
