// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
// The KiCad netlist as IFC4X3 (js/netlistIfc.js, ROAD-3583): components as occurrences (typed by their BIM
// part when they name one, else USERDEFINED), pins as IfcDistributionPort, a net as an IfcDistributionCircuit
// grouping its pins' ports — written, read back equal, and checked by IfcOpenShell when it is there.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IFC_GUID_RE, parseStep } from '../vendor/apk-contracts/apk-ifc.js';
import { KiCadModel } from '../js/kicadModel.js';
import {
  fetchPartTypes, flowOf, ifcToNetlist, modelFromNetlist, netlistFromModel, netlistToIfc, netSystemOf, partIfcUrl,
} from '../js/netlistIfc.js';
import { buildBundle, BUNDLE } from '../scripts/vendor-ifc.mjs';

const PART = 'neutrik/na-2i2o-dline';
const partTypes = () => ({ [PART]: readFileSync(new URL('./fixtures/parts/neutrik--na-2i2o-dline.ifc', import.meta.url), 'utf8') });
const byType = (text, type) => parseStep(text).entities.filter((e) => e.type === type);

/** The sample board, plus a Dante breakout typed by its BIM part, a pin with a KiCad type, a pin on no net. */
function fixtureModel() {
  const m = new KiCadModel({ id: 'kicad_fixture' });
  m.addComponent({
    ref: 'M1', value: 'NA2-IO-DLINE', footprint: 'Module:Neutrik_NA2-IO-DLINE', description: 'Dante line I/O module',
    bimId: PART,
    pins: [
      { number: '1', name: 'IN1', net: 'LINE_IN_1', type: 'input' },
      { number: '2', name: 'OUT1', net: 'AUDIO_CH1_HOT', type: 'output' },
      { number: '3', name: 'GND', net: 'GND_AUDIO', type: 'power_in' },
      { number: '4', name: 'NC', net: '' },
    ],
  });
  return m;
}
const exportFixture = () => netlistToIfc(netlistFromModel(fixtureModel()), { types: partTypes(), fileName: 'audiomatrix_breakout', editor: 'EDITORS.KiCad' });

test('the vendored STEP codec is what contracts/src/ifc builds to today', async () => {
  const now = await buildBundle();
  if (now == null) return; // this repo on its own: the committed bundle is what there is
  assert.equal(readFileSync(BUNDLE, 'utf8'), now, 'run node scripts/vendor-ifc.mjs');
});

test('the words: KiCad pin types → FlowDirection, net names → the circuit\'s system', () => {
  assert.equal(flowOf('input'), 'SINK');
  assert.equal(flowOf('power_out'), 'SOURCE');
  assert.equal(flowOf('passive'), 'SOURCEANDSINK');
  assert.equal(flowOf(''), 'SOURCEANDSINK');
  assert.equal(flowOf('no_connect'), 'NOTDEFINED');
  assert.equal(netSystemOf('GND_AUDIO'), 'EARTHING');
  assert.equal(netSystemOf('CHASSIS_EARTH'), 'EARTHING');
  assert.equal(netSystemOf('+15V_ANALOG'), 'ELECTRICAL');
  assert.equal(netSystemOf('POE_V+'), 'ELECTRICAL');
  assert.equal(netSystemOf('LINE_IN_1'), 'SIGNAL');
  assert.equal(partIfcUrl(PART, '/api/bim'), '/api/bim/parts/neutrik/na-2i2o-dline.ifc');
});

test('export: one occurrence per component, a port per pin, a circuit per net grouping its ports', () => {
  const text = exportFixture();
  assert.ok(text.startsWith('ISO-10303-21;'));
  assert.ok(text.includes("FILE_SCHEMA(('IFC4X3_ADD2'));"));
  const file = parseStep(text);
  const own = byType(text, 'IFCELECTRICAPPLIANCE');
  assert.deepEqual(own.map((e) => e.args[7]), ['U1', 'J1', 'J2'], 'Tag = the reference designator');
  assert.ok(own.every((e) => e.args[8].value === 'USERDEFINED' && e.args[4]), 'USERDEFINED with an ObjectType');
  const typed = byType(text, 'IFCAUDIOVISUALAPPLIANCE');
  assert.equal(typed.length, 1, 'M1 is an occurrence of its BIM part\'s class');
  assert.equal(typed[0].args[2], 'M1');
  const type = byType(text, 'IFCAUDIOVISUALAPPLIANCETYPE')[0];
  assert.equal(type.args[0], '3DBi9omY9H_Rn1DvdUVOzv', 'the part type keeps the GlobalId of its own .ifc');
  const rel = byType(text, 'IFCRELDEFINESBYTYPE')[0];
  assert.deepEqual([rel.args[4].map((r) => r.id), rel.args[5].id], [[typed[0].id], type.id]);
  const ports = byType(text, 'IFCDISTRIBUTIONPORT');
  assert.equal(ports.length, 8 + 3 + 8 + 4, 'one port per pin');
  assert.ok(ports.every((p) => p.args[8].value === 'CABLE'));
  const m1 = byType(text, 'IFCRELNESTS').find((r) => r.args[4].id === typed[0].id);
  assert.deepEqual(m1.args[5].map((r) => file.byId.get(r.id).args[7].value), ['SINK', 'SOURCE', 'SINK', 'SOURCEANDSINK']);
  const circuits = byType(text, 'IFCDISTRIBUTIONCIRCUIT');
  assert.equal(circuits.length, 15, 'every net the pins name');
  const gnd = circuits.find((c) => c.args[2] === 'GND_AUDIO');
  assert.equal(gnd.args[6].value, 'EARTHING');
  const group = byType(text, 'IFCRELASSIGNSTOGROUP').find((r) => r.args[6].id === gnd.id);
  assert.equal(group.args[4].length, 3, 'U1.4, J1.3 and M1.3');
  const nc = m1.args[5].map((r) => file.byId.get(r.id))[3];
  assert.equal(nc.args[9].value, 'NOTDEFINED', 'a pin on no net is in no system');
  assert.equal(byType(text, 'IFCRELCONNECTSPORTS').length, 0, 'a net is a circuit, never pairs of ports');
  const sys = byType(text, 'IFCDISTRIBUTIONSYSTEM')[0];
  const agg = byType(text, 'IFCRELAGGREGATES').find((r) => r.args[4].id === sys.id);
  assert.equal(agg.args[5].length, 15, 'every circuit in the Netlist system');
  const gids = file.entities.filter((e) => typeof e.args[0] === 'string' && IFC_GUID_RE.test(e.args[0])).map((e) => e.args[0]);
  assert.equal(new Set(gids).size, gids.length, 'GlobalIds are unique');
});

test('deterministic: the same netlist writes the same bytes', () => {
  assert.equal(exportFixture(), exportFixture());
});

test('round trip: the .ifc reads back to the same block', () => {
  const m = fixtureModel();
  const back = modelFromNetlist(ifcToNetlist(exportFixture()));
  const want = m.toJSON();
  want.components = want.components.map((c) => ({ ...c, pins: c.pins.map((p) => ({ ...p, net: p.net ?? '' })) }));
  assert.deepEqual(back, want);
  assert.deepEqual(new KiCadModel(back).toJSON(), want, 'and loads into the editor\'s model');
});

test('a part the BIM API does not answer is written USERDEFINED, still naming its part', async () => {
  const fetchFn = async () => ({ ok: false, text: async () => '' });
  const n = netlistFromModel(fixtureModel());
  const { types, missing } = await fetchPartTypes(n, new Map(), { fetchFn, base: '/api/bim' });
  assert.deepEqual([types, missing], [{}, [PART]]);
  const text = netlistToIfc(n, { types });
  assert.equal(byType(text, 'IFCAUDIOVISUALAPPLIANCE').length, 0);
  assert.equal(byType(text, 'IFCELECTRICAPPLIANCE').length, 4);
  assert.equal(ifcToNetlist(text).components[3].bimId, PART, 'APK_KiCadComponent.BimPart keeps it');
});

test('repeated refs and pin numbers still get unique GlobalIds', () => {
  const n = netlistFromModel({ id: 'dup', projectName: 'dup', components: [
    { ref: 'R1', value: '10k', footprint: 'R', description: '', pins: [{ number: '1', name: '', net: 'A' }, { number: '1', name: '', net: 'B' }] },
    { ref: 'R1', value: '22k', footprint: 'R', description: '', pins: [{ number: '1', name: '', net: 'A' }] },
  ] });
  const file = parseStep(netlistToIfc(n));
  const gids = file.entities.filter((e) => typeof e.args[0] === 'string' && IFC_GUID_RE.test(e.args[0])).map((e) => e.args[0]);
  assert.equal(new Set(gids).size, gids.length);
});

// IfcOpenShell (LGPL, test-only, never vendored) when the environment has it: APK_IFC_PYTHON=<python with ifcopenshell + ifctester>
test('IfcOpenShell: 0 schema + EXPRESS statements, every set declared, structural IDS specs pass, the netlist\'s shape holds', { skip: !process.env.APK_IFC_PYTHON && 'set APK_IFC_PYTHON to a python with ifcopenshell + ifctester' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'kicad-ifc-'));
  const files = {
    'kicad-netlist.ifc': exportFixture(),
    'kicad-sample.ifc': netlistToIfc(netlistFromModel(new KiCadModel({ id: 'kicad_sample' }))),
  };
  for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t);
  const script = new URL('../scripts/validate-ifc.py', import.meta.url).pathname;
  const run = spawnSync(process.env.APK_IFC_PYTHON, ['-I', script, ...Object.keys(files).map((n) => join(dir, n))], { cwd: tmpdir(), encoding: 'utf8' });
  const rows = run.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(rows.length, 2, run.stderr);
  for (const r of rows) {
    assert.equal(r.schema, 'IFC4X3_ADD2');
    assert.equal(r.statements, 0, `${r.file}: ${r.first.join(' | ')}`);
    assert.deepEqual(r.pset_problems, [], r.file);
    assert.deepEqual(r.connection_problems, [], r.file);
    assert.deepEqual(r.ids_failed, [], r.file);
    assert.deepEqual(r.checks, [], r.file);
  }
  const gnd = rows[0].nets.find((x) => x.name === 'GND_AUDIO');
  assert.deepEqual(gnd.members.sort(), ['J1.3', 'M1.3', 'U1.4']);
  assert.equal(run.status, 0, run.stderr);
});
