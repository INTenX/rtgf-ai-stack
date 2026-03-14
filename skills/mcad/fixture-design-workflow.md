---
skill_id: mcad/fixture-design-workflow
domain: mcad
trigger: fixture design, test fixture, MCAD, OpenSCAD, enclosure, mechanical design, DUT, pogo pin
version: "1.0"
---

# Skill: Fixture Design Workflow

## Purpose

Design and document a functional test fixture from requirements through release. Applies to in-circuit test fixtures, functional test fixtures, and production programming jigs.

## Fixture Design Stages

```
Requirements → Concept → Detailed Design → Prototype → Validation → Release
```

### 1. Requirements Capture

Before starting CAD, capture:

| Item | Questions to answer |
|------|-------------------|
| DUT (device under test) | What is being tested? PCB? Assembly? Cable? |
| Test points | Which pads/connectors need contact? Locations, pitch, current? |
| Pass/fail criteria | What measurements define pass? What defines fail? |
| Throughput | How many units per hour? Single or multi-site? |
| Operator | Who uses it? What skill level? Seated or standing? |
| Environment | Lab bench, production floor, cleanroom? Temperature range? |
| Budget | Unit cost target? Volume (prototype vs production quantity)? |

### 2. Concept Selection

Fixture types:

| Type | Best for |
|------|---------|
| Clamshell (hinged lid) | PCBs needing top and bottom contact, fast cycle |
| Bed of nails | High-pin-count ICT, flat boards |
| Edge connector | PCBs with gold fingers |
| Inline jig | Cable or harness testing |
| Custom pneumatic | High-volume production, operator fatigue concern |

### 3. Detailed Design (OpenSCAD)

Key design elements:

```scad
// DUT registration — define before anything else
dut_length = 100;
dut_width = 60;
dut_thickness = 1.6;

// Clearance allowances
registration_clearance = 0.15;  // tight for accurate placement
lid_clearance = 0.5;            // lid close/open clearance
pogo_travel = 2.0;              // spring pogo compressed travel
```

Critical dimensions to derive from DUT files (not guessed):
- Test pad locations from KiCad `.kicad_pcb` or IPC-D-356 netlist
- PCB outline from Edge.Cuts layer
- Component heights from 3D step files or datasheets

### 4. Pogo Pin Selection

| Parameter | Typical values |
|-----------|---------------|
| Spring force | 0.5–1.5N per pin (sum for operator push force) |
| Current rating | Check datasheet — 1A per pin standard, derate for high-current |
| Tip style | Point (solder joints), crown (vias), flat (pads), cup (component lead) |
| Travel | 2–3mm typical |
| Drill size | +0.1mm over pin body diameter |

Total operator force = sum of all pogo forces + any lid spring return. Keep under 30N for comfortable manual operation.

### 5. Prototype Checklist

- [ ] 3D print prototype before machining (verify DUT fit and pogo alignment)
- [ ] Check DUT insertion is single-orientation (no 180° rotation possible)
- [ ] Verify pogo stroke: PCB loaded = compressed, PCB out = extended without overtravel
- [ ] Cable routing doesn't stress connectors when lid closes
- [ ] Label positions: DUT orientation, PASS/FAIL indicators visible to operator

### 6. Validation

- [ ] 10 cycles without contact failure
- [ ] 100-cycle durability test at production rate
- [ ] Measurement repeatability: ≤0.5% variation across cycles
- [ ] Wrong orientation DUT: fixture prevents insertion or clearly fails
- [ ] Thermal: if heated, temperature uniformity measured across DUT

### 7. Release Artifacts

- [ ] STEP/STL files for machining + spare 3D-print parts
- [ ] BOM including pogo pins, springs, fasteners, wiring
- [ ] Assembly instructions with photos
- [ ] Calibration procedure
- [ ] Maintenance schedule (pogo pin replacement interval)

## Common Failures

- DUT registration too loose — misalignment causes intermittent contact
- Pogo pin compression not verified — pins bottom out or don't make contact
- No strain relief on wiring — cables break at fixture lid hinge over time
- Fixture can accept DUT in wrong orientation — field returns with damaged boards
- Total pogo force too high — operator fatigue, inconsistent engagement
