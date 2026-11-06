# Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
# MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
"""The IfcOpenShell check of an exported KiCad netlist (js/netlistIfc.js). Test-time only: IfcOpenShell is
LGPL and never vendored, never loaded by the page. The same file in EDITORS.KiCad and DATATYPE.KiCad.

    python3 -I scripts/validate-ifc.py netlist.ifc [more.ifc ...]

prints one JSON object per file:
  schema         FILE_SCHEMA (IFC4X3_ADD2)
  statements     ifcopenshell.validate with express_rules=True: every schema and where-rule finding
  pset_problems  every Pset_/Qto_ against the IFC4X3 templates and every APK_ set against apk_psets.py, by the
                 BIM repo's oracle (tools/ifc/oracle.py) when it is beside this app; connection_problems too
  ids            the STRUCTURAL apk-av.ids specifications editors_census.py holds every editor to
  nets           per IfcDistributionCircuit: Name, PredefinedType, and its members by
                 ifcopenshell.util.system.get_system_elements as <ref>.<pin>
  checks         the netlist's own shape: every circuit is aggregated in the 'Netlist' system and groups only
                 IfcDistributionPorts; every port is nested on exactly one element contained in the storey;
                 no IfcRelConnectsPorts (a net is a circuit, never a chain of pairs)
Exit status 1 when any file has a statement, a set or connection problem, a failed structural spec or a check.
"""
import json
import sys
from pathlib import Path

import ifcopenshell
import ifcopenshell.util.element as UE
import ifcopenshell.util.system as US
import ifcopenshell.validate

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parents[4] / "POD.database/DATABASE.server.BIM/SRC/tools/ifc"
STRUCTURAL = ("Every port a schematic joins says which way the signal runs",
              "Planned subnets carry their prefix",
              "Every space is part of a storey")


def _oracle():
    if (TOOLS / "oracle.py").exists():
        sys.path.insert(0, str(TOOLS))
        import oracle  # noqa: E402
        return oracle
    return None


def statements(f):
    log = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(f, log, express_rules=True)
    return [str(s.get("message", s)) if isinstance(s, dict) else str(s) for s in log.statements]


def pin_name(port):
    host = port.Nests[0].RelatingObject if port.Nests else None
    return "%s.%s" % (host.Tag if host is not None else "?", port.Name)


def checks(f):
    bad = []
    systems = [s for s in f.by_type("IfcDistributionSystem") if not s.is_a("IfcDistributionCircuit")]
    netlist = [s for s in systems if s.Name == "Netlist"]
    in_netlist = {c.id() for s in netlist for r in s.IsDecomposedBy for c in r.RelatedObjects}
    for c in f.by_type("IfcDistributionCircuit"):
        if c.id() not in in_netlist:
            bad.append("net %s is not aggregated in the Netlist system" % c.Name)
        for m in US.get_system_elements(c):
            if not m.is_a("IfcDistributionPort"):
                bad.append("net %s groups a %s, not a port" % (c.Name, m.is_a()))
    contained = {e.id() for r in f.by_type("IfcRelContainedInSpatialStructure") for e in r.RelatedElements}
    for p in f.by_type("IfcDistributionPort"):
        nests = [r for r in p.Nests or []]
        if len(nests) != 1:
            bad.append("port %s is nested %d times" % (p.Name, len(nests)))
            continue
        host = nests[0].RelatingObject
        if host.is_a("IfcTypeObject"):
            continue  # a BIM part type's own ports
        if host.id() not in contained:
            bad.append("port %s sits on %s, which is not in the storey" % (pin_name(p), host.Name))
    if f.by_type("IfcRelConnectsPorts"):
        bad.append("%d IfcRelConnectsPorts: a net is a circuit, not pairs" % len(f.by_type("IfcRelConnectsPorts")))
    return bad


def main(paths):
    oracle = _oracle()
    worst = 0
    for path in paths:
        f = ifcopenshell.open(path)
        st = statements(f)
        pp = oracle.pset_problems(f) if oracle else []
        cp = getattr(oracle, "connection_problems", lambda _f: [])(f) if oracle else []
        ids_rows = [list(r) for r in oracle.ids_results(f)] if oracle else []
        ids_bad = [r for r in ids_rows if r[0] in STRUCTURAL and not r[1]]
        ck = checks(f)
        nets = [{"name": c.Name, "type": c.PredefinedType, "members": [pin_name(p) for p in US.get_system_elements(c)]}
                for c in f.by_type("IfcDistributionCircuit")]
        print(json.dumps({"file": path, "schema": f.schema_identifier, "statements": len(st), "first": st[:5],
                          "pset_problems": pp, "connection_problems": cp, "ids": ids_rows, "ids_failed": ids_bad,
                          "nets": nets, "checks": ck, "oracle": bool(oracle)}))
        if st or pp or cp or ids_bad or ck:
            worst = 1
    return worst


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
