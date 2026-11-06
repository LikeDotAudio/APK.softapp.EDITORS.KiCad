// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* netlistIfc.js — A KICAD NETLIST AS ITS .IFC TWIN (ROAD-3583). Save Model writes the page's native
   block AND this IFC4X3_ADD2 file through APKSoftapp.saveModel; Open Model reads it back to the same
   block. The same bytes in EDITORS.KiCad and DATATYPE.KiCad (one netlist, two pages): change them
   together. Written with the contracts STEP codec (vendor/apk-contracts/apk-ifc.js, scripts/vendor-ifc.mjs),
   no IfcOpenShell in the page. Byte-deterministic: the same netlist writes the same file; every GlobalId
   is uuid5 of a role under the netlist (contracts ifcGuid), an embedded BIM part type keeps its own.

     IfcProject ─ IfcSite ─ IfcBuilding ─ IfcBuildingStorey     units mm · kg · W (· V A Hz Ω for part types)
     the block   APK_KiCadNetlist on the project (Schema, NetlistId, BlockType)
     component   one occurrence per reference designator (Name = Tag = the ref, Description = its description):
                 typed by its BIM part (IfcRelDefinesByType to the part's own type, embedded from
                 GET /api/bim/parts/<maker>/<model>.ifc) when the component names one (bimId); else an
                 IfcElectricAppliance USERDEFINED whose ObjectType is the KiCad symbol (lib:part), else its value.
                 APK_KiCadComponent: Value, Footprint, Library, Symbol, BimPart, Listed (false: named only by a net)
     a pin       IfcDistributionPort CABLE nested on its component (IfcRelNests), Name = the pin number,
                 Description = the pin name, FlowDirection from the KiCad pin type (SOURCEANDSINK when it
                 has none), SystemType = its net's; APK_KiCadPin.ElectricalType when the pin has one
     a net       IfcDistributionCircuit (Name = the net name, PredefinedType EARTHING | ELECTRICAL | SIGNAL by
                 its name) with its pins' ports assigned by one IfcRelAssignsToGroup; APK_KiCadNet.Code.
                 Every circuit is aggregated in one IfcDistributionSystem 'Netlist' (IfcRelAggregates).

   WHY A CIRCUIT PER NET, NOT IfcRelConnectsPorts: a net is an unordered set of N pins. IfcRelConnectsPorts
   joins exactly two ports, and IFC4X3_ADD2 bounds IfcPort.ConnectedTo and .ConnectedFrom to SET [0:1], so a
   pin can sit in at most one relationship per side: a star (one pin to every other) is not valid IFC, and a
   daisy chain invents an order the netlist does not have, forces SOURCEANDSINK on every pin and drops a
   one-pin net (nothing to join). IfcDistributionCircuit (an IfcDistributionSystem, an IfcGroup) takes any
   number of IfcObjectDefinitions through IfcRelAssignsToGroup.RelatedObjects, ports included, keeps the net's
   own name, and is what IFC calls a circuit. Nothing here is an IfcRelConnectsPorts.
   Everything else is ISO 16739 or an APK_ set declared in DATABASE.server.BIM SRC/tools/ifc/apk_psets_editors.py.

   The netlist both pages save (netlistFromModel / netlistFromBlock make it, modelFromNetlist /
   blockFromNetlist give each page its own block back):
     { id, name, blockType: 'kicad' | 'kicad_netlist',
       components: [{ ref, value, footprint, description, lib, part, bimId, listed, pins: [{ number, name, type }] }],
       nets: [{ name, code, nodes: [{ ref, pin }] }] } */

import { entitiesByType, enumv, getPsets, ifcGuid, isRef, isTypeObject, parseStep, ports as portsOf, real, ref, typed, unwrap, writeStep } from '../vendor/apk-contracts/apk-ifc.js';

export const NETLIST_IFC_SCHEMA = 'IFC4X3_ADD2';
export const NATIVE_SCHEMA = 'apk.kicad/1';
const STAMP = '1970-01-01T00:00:00'; // fixed: the file is a function of the netlist, never of the clock
const DERIVED = { kind: 'derived' };

const str = (v) => (v == null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const label = (s) => typed('IFCLABEL', String(s));
const ident = (s) => typed('IFCIDENTIFIER', String(s));
const bool = (b) => typed('IFCBOOLEAN', enumv(b ? 'T' : 'F'));
const int = (n) => typed('IFCINTEGER', Math.trunc(n));
const nodeKey = (r, p) => `${r}\u0000${p}`;

/* ------------------------------------------------------------------ the two pages' blocks */

/** EDITORS.KiCad's model (KiCadModel or its toJSON(): components[] with pins[{number, name, net}]) → the netlist. */
export function netlistFromModel(model) {
  const j = model && typeof model.toJSON === 'function' ? model.toJSON() : model || {};
  const nets = new Map();
  const components = arr(j.components).map((c) => {
    const ref0 = str(c.ref);
    for (const p of arr(c.pins)) {
      const n = str(p.net);
      if (!n) continue;
      if (!nets.has(n)) nets.set(n, []);
      nets.get(n).push({ ref: ref0, pin: str(p.number) });
    }
    return {
      ref: ref0, value: str(c.value), footprint: str(c.footprint), description: str(c.description),
      lib: str(c.lib), part: str(c.part), bimId: str(c.bimId || c.bimRef?.part), listed: true,
      pins: arr(c.pins).map((p) => ({ number: str(p.number), name: str(p.name), type: str(p.type) })),
    };
  });
  return {
    id: str(j.id), name: str(j.projectName), blockType: 'kicad', components,
    nets: [...nets].map(([name, nodes], i) => ({ name, code: i + 1, nodes })),
  };
}

/** The netlist → EDITORS.KiCad's block ({type: 'kicad', id, projectName, components}); each pin's net is the one it is in. */
export function modelFromNetlist(n) {
  const netOf = new Map();
  for (const net of arr(n.nets)) for (const x of net.nodes) if (!netOf.has(nodeKey(x.ref, x.pin))) netOf.set(nodeKey(x.ref, x.pin), net.name);
  const out = {
    type: 'kicad',
    ...(n.id ? { id: n.id } : {}),
    projectName: str(n.name),
    components: arr(n.components).filter((c) => c.listed !== false).map((c) => {
      const o = { ref: c.ref, value: c.value, footprint: c.footprint, description: c.description };
      if (c.lib) o.lib = c.lib;
      if (c.part) o.part = c.part;
      if (c.bimId) o.bimId = c.bimId;
      o.pins = arr(c.pins).map((p) => {
        const pin = { number: p.number, name: p.name, net: netOf.get(nodeKey(c.ref, p.number)) ?? '' };
        if (p.type) pin.type = p.type;
        return pin;
      });
      return o;
    }),
  };
  return out;
}

/** DATATYPE.KiCad's block ({components: [{ref, value, footprint, lib, part}], nets: [{name, nodes}]}) → the netlist.
    Its components carry no pins: each component's pins are the nodes the nets name on it, in net order; a node
    on a ref the component list does not have becomes a component with listed: false. */
export function netlistFromBlock(block) {
  const b = block && typeof block === 'object' ? block : {};
  const byRef = new Map();
  const components = arr(b.components).map((c) => {
    const o = {
      ref: str(c.ref), value: str(c.value), footprint: str(c.footprint), description: str(c.description),
      lib: str(c.lib), part: str(c.part), bimId: str(c.bimId || c.bimRef?.part), listed: true, pins: [],
    };
    if (!byRef.has(o.ref)) byRef.set(o.ref, o);
    return o;
  });
  const nets = arr(b.nets).map((net, i) => ({
    name: str(net.name), code: i + 1,
    nodes: arr(net.nodes).map((x) => ({ ref: str(x.ref), pin: str(x.pin) })),
  }));
  for (const net of nets) {
    for (const x of net.nodes) {
      let c = byRef.get(x.ref);
      if (!c) {
        c = { ref: x.ref, value: '', footprint: '', description: '', lib: '', part: '', bimId: '', listed: false, pins: [] };
        byRef.set(x.ref, c);
        components.push(c);
      }
      if (!c.pins.some((p) => p.number === x.pin)) c.pins.push({ number: x.pin, name: '', type: '' });
    }
  }
  return { id: str(b.id), name: str(b.name) || 'kicad_netlist', blockType: 'kicad_netlist', components, nets };
}

/** The netlist → DATATYPE.KiCad's block ({type: 'kicad_netlist', components, nets}). */
export function blockFromNetlist(n) {
  return {
    type: 'kicad_netlist',
    components: arr(n.components).filter((c) => c.listed !== false).map((c) => {
      const o = { ref: c.ref, value: c.value, footprint: c.footprint, lib: c.lib, part: c.part };
      if (c.bimId) o.bimId = c.bimId;
      return o;
    }),
    nets: arr(n.nets).map((net) => ({ name: net.name, nodes: net.nodes.map((x) => ({ ref: x.ref, pin: x.pin })) })),
  };
}

/* ------------------------------------------------------------------ words */

/** IfcFlowDirectionEnum of a KiCad pin electrical type (Eeschema's pin types); '' (none given) is SOURCEANDSINK. */
export function flowOf(pinType) {
  const t = str(pinType).toLowerCase().replace(/[\s-]+/g, '_');
  if (t === 'input' || t === 'power_in') return 'SINK';
  if (t === 'output' || t === 'power_out' || t === 'open_collector' || t === 'open_emitter') return 'SOURCE';
  if (t === 'no_connect' || t === 'not_connected') return 'NOTDEFINED';
  return 'SOURCEANDSINK'; // passive, bidirectional, tri_state, unspecified, free, or none given
}

/** IfcDistributionSystemEnum of a net by its name: grounds EARTHING, supply rails ELECTRICAL, the rest SIGNAL. */
export function netSystemOf(name) {
  const t = str(name).toUpperCase();
  if (/(^|[^A-Z])(GND|GROUND|EARTH|CHASSIS|SHIELD|AGND|DGND|PGND)([^A-Z]|$)/.test(t)) return 'EARTHING';
  if (/^[+-]?\d+(\.\d+)?V/.test(t) || /(^|[^A-Z])(VCC|VDD|VEE|VSS|VBUS|PWR|POE|V\+|V-)([^A-Z]|$)/.test(t)) return 'ELECTRICAL';
  return 'SIGNAL';
}

/* ------------------------------------------------------------------ part types */

export const bimApi = () => String(globalThis.APK_BIM_API || '/api/bim').replace(/\/$/, '');

/** The URL of a part's .ifc type (ids are <maker>/<model>). */
export function partIfcUrl(pid, base = bimApi()) {
  const [maker, model] = String(pid).split('/');
  return `${base}/parts/${encodeURIComponent(maker)}/${encodeURIComponent(model ?? '')}.ifc`;
}

/** Fetch the .ifc type of every BIM part the netlist's components name (cache: Map pid → text | null).
    → { types: {pid: text}, missing: [pid] }. A part that does not answer is written USERDEFINED, naming it. */
export async function fetchPartTypes(netlist, cache = new Map(), { fetchFn = globalThis.fetch, base = bimApi() } = {}) {
  const ids = [...new Set(arr(netlist.components).map((c) => c.bimId).filter(Boolean))].sort();
  const types = {};
  const missing = [];
  for (const pid of ids) {
    if (!cache.has(pid)) {
      let text = null;
      try {
        const r = await fetchFn(partIfcUrl(pid, base), { headers: { Accept: 'model/step, application/x-step' } });
        if (r.ok) text = await r.text();
      } catch (_) { text = null; }
      cache.set(pid, text && text.startsWith('ISO-10303-21') ? text : null);
    }
    if (cache.get(pid)) types[pid] = cache.get(pid);
    else missing.push(pid);
  }
  return { types, missing };
}

/** The type object a part's .ifc is about: the one tagged with the part id, else its only one. */
export function partTypeEntity(file, partId) {
  const types = file.entities.filter((e) => isTypeObject(e.type));
  return types.find((t) => t.args[7] === partId) ?? (types.length === 1 ? types[0] : null);
}

/* ------------------------------------------------------------------ write */

class Writer {
  constructor() { this.entities = []; }
  add(type, ...args) {
    const id = this.entities.length + 1;
    this.entities.push({ id, type, args });
    return ref(id);
  }
}

function occurrenceArgs(entity, { gid, name, desc, objectType, tag, predefined = null }) {
  const head = [gid, null, name || null, desc || null, objectType || null, null, null, tag || null];
  if (entity === 'IFCELEMENTASSEMBLY') return [...head, enumv('NOTDEFINED'), predefined ? enumv(predefined) : null];
  if (entity === 'IFCMECHANICALFASTENER') return [...head, null, null, predefined ? enumv(predefined) : null];
  if (entity === 'IFCDISTRIBUTIONELEMENT') return head;
  return [...head, predefined ? enumv(predefined) : null];
}

/** Unique keys for possibly repeated words: 'U1', 'U1', 'U2' → 'U1', 'U1#2', 'U2'. */
function uniqueKeys(words) {
  const seen = new Map();
  return words.map((w) => {
    const n = (seen.get(w) ?? 0) + 1;
    seen.set(w, n);
    return n === 1 ? w : `${w}#${n}`;
  });
}

/**
 * The netlist (netlistFromModel / netlistFromBlock) as IFC4X3_ADD2 STEP text.
 *   types     {partId: the part's .ifc text}: each component's BIM type, embedded with its ports and sets
 *   fileName  the file stem written into FILE_NAME
 *   editor    the app written into FILE_NAME's originating system
 */
export function netlistToIfc(netlist, { types = {}, fileName = null, editor = 'APK.audio KiCad' } = {}) {
  const N = netlist || {};
  const W = new Writer();
  const key = str(N.id) || str(N.name) || 'kicad';
  const g = (...roles) => ifcGuid('kicad', key, ...roles);

  // ---- units and contexts
  const si = (type, prefix, name) => W.add('IFCSIUNIT', DERIVED, enumv(type), prefix ? enumv(prefix) : null, enumv(name));
  const units = [
    ['LENGTHUNIT', 'MILLI', 'METRE'], ['MASSUNIT', 'KILO', 'GRAM'], ['POWERUNIT', null, 'WATT'],
    ['ELECTRICVOLTAGEUNIT', null, 'VOLT'], ['ELECTRICCURRENTUNIT', null, 'AMPERE'], ['FREQUENCYUNIT', null, 'HERTZ'],
    ['ELECTRICRESISTANCEUNIT', null, 'OHM'],
  ];
  const unitRef = new Map(units.map(([t, p, n]) => [`${t}/${p ?? ''}/${n}`, si(t, p, n)]));
  const unitAssignment = W.add('IFCUNITASSIGNMENT', [...unitRef.values()]);
  const origin = W.add('IFCAXIS2PLACEMENT3D', W.add('IFCCARTESIANPOINT', [real(0), real(0), real(0)]), null, null);
  const ctx = W.add('IFCGEOMETRICREPRESENTATIONCONTEXT', null, 'Model', 3, real(1e-5), origin, null);
  const bodyCtx = W.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', 'Body', 'Model', DERIVED, DERIVED, DERIVED, DERIVED, ctx, null, enumv('MODEL_VIEW'), null);
  const project = W.add('IFCPROJECT', g('project'), null, str(N.name) || 'KiCad netlist', 'KiCad netlist', null, null, null, [ctx], unitAssignment);

  // ---- property helpers
  const single = (name, value) => W.add('IFCPROPERTYSINGLEVALUE', name, null, value, null);
  const pset = (owner, ownerKey, name, props) => {
    const list = props.filter(Boolean);
    if (!list.length) return null;
    const ps = W.add('IFCPROPERTYSET', g('pset', ownerKey, name), null, name, null, list);
    W.add('IFCRELDEFINESBYPROPERTIES', g('props', ownerKey, name), null, null, null, [owner], ps);
    return ps;
  };

  // ---- the spine
  const sitePl = W.add('IFCLOCALPLACEMENT', null, origin);
  const buildingPl = W.add('IFCLOCALPLACEMENT', sitePl, origin);
  const storeyPl = W.add('IFCLOCALPLACEMENT', buildingPl, origin);
  const site = W.add('IFCSITE', g('site'), null, 'Site', null, null, sitePl, null, null, enumv('ELEMENT'), null, null, null, null, null);
  const building = W.add('IFCBUILDING', g('building'), null, 'Building', null, null, buildingPl, null, null, enumv('ELEMENT'), null, null, null);
  const storey = W.add('IFCBUILDINGSTOREY', g('storey'), null, 'Level 0', null, null, storeyPl, null, null, enumv('ELEMENT'), real(0));
  W.add('IFCRELAGGREGATES', g('aggregates', 'project'), null, null, null, project, [site]);
  W.add('IFCRELAGGREGATES', g('aggregates', 'site'), null, null, null, site, [building]);
  W.add('IFCRELAGGREGATES', g('aggregates', 'building'), null, null, null, building, [storey]);
  pset(project, 'project', 'APK_KiCadNetlist', [
    single('Schema', ident(NATIVE_SCHEMA)),
    N.id ? single('NetlistId', ident(N.id)) : null,
    N.blockType ? single('BlockType', label(N.blockType)) : null,
  ]);

  // ---- part types, embedded once each
  const declared = [];
  const embedded = new Map();
  const unitByKey = (u) => unitRef.get(`${u.args[1].value}/${u.args[2] ? u.args[2].value : ''}/${u.args[3].value}`);
  const contextUnits = new Map();
  const embed = (pid) => {
    if (embedded.has(pid)) return embedded.get(pid);
    let out = null;
    const text = types[pid];
    if (typeof text === 'string' && text) {
      const file = parseStep(text);
      const t = partTypeEntity(file, pid);
      if (t) out = { ...copyType(W, file, t, { ctx, bodyCtx, unitByKey, contextUnits }), pid, occ: [] };
    }
    if (out) declared.push(out.ref);
    embedded.set(pid, out);
    return out;
  };

  // ---- the nets' words first: a port's SystemType is its net's
  const nets = arr(N.nets);
  const netKeys = uniqueKeys(nets.map((n) => str(n.name)));
  const netOfNode = new Map();
  nets.forEach((net) => { for (const x of arr(net.nodes)) if (!netOfNode.has(nodeKey(x.ref, x.pin))) netOfNode.set(nodeKey(x.ref, x.pin), net.name); });

  // ---- components and their pins
  const comps = arr(N.components);
  const compKeys = uniqueKeys(comps.map((c) => str(c.ref)));
  const portOf = new Map(); // nodeKey(ref, pin) → the first port of that pin
  const contained = [];
  comps.forEach((c, i) => {
    const ck = compKeys[i];
    const t = c.bimId ? embed(c.bimId) : null;
    const entity = t ? t.entity.replace(/TYPE$/, '') : 'IFCELECTRICAPPLIANCE';
    const symbol = c.lib && c.part ? `${c.lib}:${c.part}` : c.part || '';
    const o = W.add(entity, ...occurrenceArgs(entity, {
      gid: g('component', ck), name: c.ref, desc: c.description, tag: c.ref,
      objectType: t ? null : symbol || c.value || 'KiCadComponent', predefined: t ? null : 'USERDEFINED',
    }));
    if (t) t.occ.push(o);
    contained.push(o);
    pset(o, `component/${ck}`, 'APK_KiCadComponent', [
      c.value ? single('Value', label(c.value)) : null,
      c.footprint ? single('Footprint', label(c.footprint)) : null,
      c.lib ? single('Library', label(c.lib)) : null,
      c.part ? single('Symbol', label(c.part)) : null,
      c.bimId ? single('BimPart', ident(c.bimId)) : null,
      c.listed === false ? single('Listed', bool(false)) : null,
    ]);
    const pins = arr(c.pins);
    const pinKeys = uniqueKeys(pins.map((p) => str(p.number)));
    const refs = pins.map((p, j) => {
      const net = netOfNode.get(nodeKey(c.ref, p.number));
      const port = W.add('IFCDISTRIBUTIONPORT', g('pin', ck, pinKeys[j]), null, str(p.number), p.name || null, null, null, null,
        enumv(flowOf(p.type)), enumv('CABLE'), enumv(net != null ? netSystemOf(net) : 'NOTDEFINED'));
      if (p.type) pset(port, `pin/${ck}/${pinKeys[j]}`, 'APK_KiCadPin', [single('ElectricalType', label(p.type))]);
      if (!portOf.has(nodeKey(c.ref, p.number))) portOf.set(nodeKey(c.ref, p.number), port);
      return port;
    });
    if (refs.length) W.add('IFCRELNESTS', g('nests', ck), null, 'Pins', null, o, refs);
  });

  // ---- nets: one circuit each, its pins' ports assigned to it
  const system = nets.length ? W.add('IFCDISTRIBUTIONSYSTEM', g('netlist'), null, 'Netlist', null, null, str(N.name) || null, enumv('ELECTRICAL')) : null;
  const circuits = nets.map((net, i) => {
    const nk = netKeys[i];
    const c = W.add('IFCDISTRIBUTIONCIRCUIT', g('net', nk), null, str(net.name), null, null, null, enumv(netSystemOf(net.name)));
    const members = [];
    for (const x of arr(net.nodes)) {
      const p = portOf.get(nodeKey(x.ref, x.pin));
      if (p && !members.some((m) => m.id === p.id)) members.push(p);
    }
    if (members.length) W.add('IFCRELASSIGNSTOGROUP', g('group', 'net', nk), null, null, null, members, null, c);
    pset(c, `net/${nk}`, 'APK_KiCadNet', [Number.isFinite(Number(net.code)) && net.code !== '' && net.code != null ? single('Code', int(Number(net.code))) : null]);
    return c;
  });
  if (system) W.add('IFCRELAGGREGATES', g('aggregates', 'netlist'), null, 'Nets', null, system, circuits);

  // ---- types, declarations, containment
  for (const [pid, t] of embedded) if (t && t.occ.length) W.add('IFCRELDEFINESBYTYPE', g('typed', 'part', pid), null, null, null, t.occ, t.ref);
  if (declared.length) W.add('IFCRELDECLARES', g('declares'), null, null, null, project, declared);
  if (contained.length) W.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', g('contains', 'storey'), null, null, null, contained, storey);

  const stem = str(fileName || N.name || 'netlist').replace(/\.(ifc|json|net)$/i, '');
  const header = [
    { type: 'FILE_DESCRIPTION', args: [['ViewDefinition [ReferenceView]'], '2;1'] },
    { type: 'FILE_NAME', args: [`${stem}.ifc`, STAMP, ['APK.audio'], ['APK.audio'], editor, 'APK.audio KiCad netlist', ''] },
    { type: 'FILE_SCHEMA', args: [[NETLIST_IFC_SCHEMA]] },
  ];
  return writeStep({ header, entities: W.entities });
}

/**
 * Copy one part's type object out of its own .ifc into W: the type, its sets, its nested ports and their
 * sets, keeping their GlobalIds. The part file's owner history goes (it is optional), its units and
 * contexts become this file's. → {ref, entity, name}. (EDITORS.PowerChain's copyType, the same rule.)
 */
function copyType(W, file, t, { ctx, bodyCtx, unitByKey, contextUnits }) {
  const include = new Set([t.id]);
  const portIds = new Set();
  for (const e of file.entities) {
    if (e.type === 'IFCRELNESTS' && isRef(e.args[4]) && e.args[4].id === t.id) {
      include.add(e.id);
      for (const r of e.args[5] ?? []) if (isRef(r)) portIds.add(r.id);
    }
  }
  for (const id of portIds) include.add(id);
  for (const e of file.entities) {
    if (e.type === 'IFCRELDEFINESBYPROPERTIES' && (e.args[4] ?? []).every((r) => isRef(r) && portIds.has(r.id))) include.add(e.id);
  }
  const map = new Map();
  const mapped = (id) => {
    const e = file.byId.get(id);
    if (!e) return undefined;
    if (e.type === 'IFCOWNERHISTORY') return null;
    if (e.type === 'IFCGEOMETRICREPRESENTATIONCONTEXT') return ctx;
    if (e.type === 'IFCGEOMETRICREPRESENTATIONSUBCONTEXT') return bodyCtx;
    if (e.type === 'IFCSIUNIT') return unitByKey(e) ?? undefined;
    if (e.type === 'IFCCONTEXTDEPENDENTUNIT' && contextUnits.has(e.args[2])) return contextUnits.get(e.args[2]);
    return undefined;
  };
  const order = [];
  const visit = (id) => {
    if (map.has(id)) return;
    const m = mapped(id);
    if (m !== undefined) { map.set(id, m); return; }
    map.set(id, 'pending');
    order.push(id);
    const e = file.byId.get(id);
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (isRef(v)) visit(v.id);
      else if (v && typeof v === 'object' && v.kind === 'typed') walk(v.value);
    };
    e.args.forEach(walk);
  };
  [...include].sort((a, b) => a - b).forEach(visit);
  order.sort((a, b) => a - b);
  const base = W.entities.length;
  order.forEach((id, i) => map.set(id, ref(base + i + 1)));
  const remap = (v) => {
    if (Array.isArray(v)) return v.map(remap);
    if (isRef(v)) return map.get(v.id);
    if (v && typeof v === 'object' && v.kind === 'typed') return { ...v, value: remap(v.value) };
    return v;
  };
  for (const id of order) {
    const e = file.byId.get(id);
    const r = W.add(e.type, ...e.args.map(remap));
    if (e.type === 'IFCCONTEXTDEPENDENTUNIT') contextUnits.set(e.args[2], r);
  }
  return { ref: map.get(t.id), entity: t.type, name: t.args[2] };
}

/* ------------------------------------------------------------------ read */

/** An .ifc this module wrote (or any IFC4X3 file built the same way) → the netlist. Throws on a file with no project. */
export function ifcToNetlist(text) {
  const file = typeof text === 'string' ? parseStep(text) : text;
  const project = entitiesByType(file, 'IFCPROJECT')[0];
  if (!project) throw new Error('the file has no IfcProject: it is not an IFC model');
  const top = getPsets(file, project).APK_KiCadNetlist ?? {};
  const elements = [];
  for (const rel of entitiesByType(file, 'IFCRELCONTAINEDINSPATIALSTRUCTURE')) {
    for (const r of arr(rel.args[4])) { const e = isRef(r) && file.byId.get(r.id); if (e && !elements.includes(e)) elements.push(e); }
  }
  const owner = new Map(); // port id → { ref, pin }
  const components = elements.map((e) => {
    const ps = getPsets(file, e);
    const k = ps.APK_KiCadComponent ?? {};
    const refName = str(e.args[7] ?? e.args[2]);
    const pins = portsOf(file, e).map((p) => {
      const pin = { number: str(p.args[2]), name: str(p.args[3]), type: str(getPsets(file, p).APK_KiCadPin?.ElectricalType) };
      owner.set(p.id, { ref: refName, pin: pin.number });
      return pin;
    });
    return {
      ref: refName, value: str(k.Value), footprint: str(k.Footprint), description: str(e.args[3]),
      lib: str(k.Library), part: str(k.Symbol), bimId: str(k.BimPart ?? ps.APK_Part?.PartId), listed: k.Listed !== false, pins,
    };
  });
  const groupOf = new Map();
  for (const rel of entitiesByType(file, 'IFCRELASSIGNSTOGROUP')) {
    const gid = isRef(rel.args[6]) ? rel.args[6].id : null;
    if (gid == null) continue;
    if (!groupOf.has(gid)) groupOf.set(gid, []);
    groupOf.get(gid).push(...arr(rel.args[4]).filter(isRef).map((r) => r.id));
  }
  const nets = entitiesByType(file, 'IFCDISTRIBUTIONCIRCUIT').map((c, i) => {
    const code = unwrap(getPsets(file, c).APK_KiCadNet?.Code);
    return {
      name: str(c.args[2]),
      code: typeof code === 'number' ? code : i + 1,
      nodes: (groupOf.get(c.id) ?? []).map((id) => owner.get(id)).filter(Boolean).map((x) => ({ ref: x.ref, pin: x.pin })),
    };
  });
  return {
    id: str(top.NetlistId), name: str(project.args[2]), blockType: str(top.BlockType),
    components, nets,
  };
}
