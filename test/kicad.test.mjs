// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import test from 'node:test';
import assert from 'node:assert/strict';
import { KiCadModel } from '../js/kicadModel.js';
import { renderKiCadSchematicSvg } from '../js/kicadSvg.js';

test('KiCadModel initializes with sample audio IC and connector components', () => {
  const model = new KiCadModel();
  assert.equal(model.projectName, 'AudioMatrix_Breakout');
  assert.ok(model.components.length >= 3);
  const u1 = model.components.find((c) => c.ref === 'U1');
  assert.ok(u1);
  assert.equal(u1.value, 'OPA1612');
  assert.equal(u1.pins.length, 8);
});

test('KiCadModel buildNetMap groups nodes by net name', () => {
  const model = new KiCadModel();
  const netMap = model.buildNetMap();
  assert.ok(netMap.has('LINE_IN_1'));
  const nodes = netMap.get('LINE_IN_1');
  assert.equal(nodes.length, 2); // U1 pin 3 and J1 pin 2
  assert.ok(nodes.some((n) => n.ref === 'U1' && n.pin === '3'));
  assert.ok(nodes.some((n) => n.ref === 'J1' && n.pin === '2'));
});

test('generateKiCadNetlist produces valid KiCad sexpr format', () => {
  const model = new KiCadModel();
  const netlist = model.generateKiCadNetlist();
  assert.ok(netlist.startsWith('(export (version "E")'));
  assert.ok(netlist.includes('(components'));
  assert.ok(netlist.includes('(comp (ref "U1")'));
  assert.ok(netlist.includes('(nets'));
  assert.ok(netlist.includes('(net (code 1) (name "AUDIO_CH1_HOT")'));
  assert.ok(netlist.endsWith(')'));
});

test('renderKiCadSchematicSvg renders SVG markup with component cards and pins', () => {
  const model = new KiCadModel();
  const svg = renderKiCadSchematicSvg(model);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('kicad-comp-card'));
  assert.ok(svg.includes('OPA1612'));
  assert.ok(svg.includes('Neutrik_NC3FAAH'));
});
