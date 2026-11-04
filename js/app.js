// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { BlockBridge } from './blockBridge.js';
import { KiCadModel } from './kicadModel.js';
import { renderKiCadSchematicSvg } from './kicadSvg.js';

let model = new KiCadModel();
let activeTab = 'schematic'; // 'schematic' | 'netlist'

const bridge = new BlockBridge({
  name: 'KiCad Netlist Generator',
  type: 'kicad',
  defaultBlock: model.toJSON(),
  onBlockLoaded: (block) => {
    if (block) {
      model = new KiCadModel(block);
      renderAll();
    }
  },
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
        <span style="font-weight: 700; color: var(--osc-text-primary); font-size: 13px;">${comp.ref} — ${comp.value}</span>
        <button class="btn btn-secondary btn-sm" id="btn-delete-comp" style="color: var(--osc-status-danger);">🗑️ Delete</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">REFERENCE DESIGNATION</label>
          <input type="text" class="input" id="inp-ref" value="${comp.ref}">
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">VALUE / PART NUMBER</label>
          <input type="text" class="input" id="inp-val" value="${comp.value}">
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">KICAD FOOTPRINT</label>
          <input type="text" class="input" id="inp-footprint" value="${comp.footprint}">
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">DESCRIPTION</label>
          <input type="text" class="input" id="inp-desc" value="${comp.description}">
        </div>

        <div style="margin-top: 6px;">
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 4px;">PINS & NET CONNECTIONS</label>
          <div style="display: flex; flex-direction: column; gap: 4px; max-height: 200px; overflow-y: auto;">
            ${comp.pins.map((p, idx) => `
              <div style="display: grid; grid-template-columns: 32px 1fr 1fr; gap: 4px; align-items: center;">
                <input type="text" class="input pin-num" data-idx="${idx}" value="${p.number}" style="padding: 3px 5px; font-size: 10px; text-align: center;">
                <input type="text" class="input pin-name" data-idx="${idx}" value="${p.name}" style="padding: 3px 5px; font-size: 10px;">
                <input type="text" class="input pin-net" data-idx="${idx}" value="${p.net || ''}" placeholder="Net..." style="padding: 3px 5px; font-size: 10px; color: var(--osc-accent-primary);">
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-delete-comp')?.addEventListener('click', () => {
      model.deleteComponent(comp.ref);
      bridge.notifyChanged();
      renderAll();
    });

    document.getElementById('inp-ref')?.addEventListener('input', (e) => {
      comp.ref = e.target.value;
      bridge.notifyChanged();
      renderView();
    });

    document.getElementById('inp-val')?.addEventListener('input', (e) => {
      comp.value = e.target.value;
      bridge.notifyChanged();
      renderView();
    });

    document.getElementById('inp-footprint')?.addEventListener('input', (e) => {
      comp.footprint = e.target.value;
      bridge.notifyChanged();
      renderView();
    });

    document.getElementById('inp-desc')?.addEventListener('input', (e) => {
      comp.description = e.target.value;
      bridge.notifyChanged();
    });

    container.querySelectorAll('.pin-net').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'), 10);
        if (comp.pins[idx]) {
          comp.pins[idx].net = e.target.value;
          bridge.notifyChanged();
          renderView();
        }
      });
    });

  } else {
    container.innerHTML = `
      <div style="padding: 20px 10px; text-align: center; color: var(--osc-text-muted);">
        <div style="font-size: 28px; margin-bottom: 8px; opacity: 0.5;">🔌</div>
        <div>Select a component block to inspect and modify pins, footprints, and net connections.</div>
      </div>
    `;
  }
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
      <span>COMPONENTS: <strong style="color: var(--osc-text-primary);">${model.components.length}</strong></span>
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
    bridge.notifyChanged();
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
          model = new KiCadModel(parsed);
          bridge.loadBlock(model.toJSON(), { filename: file.name });
          renderAll();
        } catch (err) {
          alert('Failed to parse KiCad json: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });

  document.getElementById('btn-discovered')?.addEventListener('click', async () => {
    const project = await bridge.fetchDiscoveredProject();
    if (project) {
      alert(`Discovered Project: ${project.project_name || 'KiCad Systems'}\nComponents: ${model.components.length}`);
    } else {
      alert('Connecting to live discovery bus...');
    }
  });

  document.getElementById('btn-save-block')?.addEventListener('click', () => {
    bridge.saveBlock(model.toJSON(), { filename: model.projectName.toLowerCase() });
  });

  document.getElementById('btn-close')?.addEventListener('click', () => {
    bridge.close();
  });
});
