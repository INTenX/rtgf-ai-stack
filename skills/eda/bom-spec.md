---
skill_id: eda/bom-spec
domain: eda
trigger: BOM, bill of materials, parts list, component spec, Mouser, Digikey, LCSC, sourcing
version: "1.0"
---

# Skill: BOM Specification and Review

## Purpose

Produce and review a complete, sourceable Bill of Materials. A good BOM has no ambiguous components, at least two sources per critical part, and pricing validated against the build quantity.

## BOM Columns (Minimum)

| Column | Notes |
|--------|-------|
| Reference | e.g. R1, C3, U2 |
| Quantity | Per board |
| Value | Resistance, capacitance, voltage rating, etc. |
| Description | Human-readable function |
| Manufacturer | Preferred manufacturer |
| MPN | Manufacturer Part Number — must be specific (no generic) |
| Supplier 1 | Digikey, Mouser, LCSC, etc. |
| Supplier 1 PN | Exact supplier part number |
| Supplier 2 | Alternate source |
| Supplier 2 PN | |
| Unit cost | At build quantity |
| Extended cost | Qty × unit cost |
| Notes | DNP, substitution notes, lifecycle flags |

## Review Checklist

### Completeness

- [ ] Every schematic component has a BOM entry
- [ ] DNP (do not populate) parts explicitly marked
- [ ] No generic MPNs (e.g. "generic NPN" must be a specific part)
- [ ] All voltages, tolerances, and package sizes specified

### Sourcing

- [ ] All critical parts have ≥2 sources
- [ ] Lifecycle status checked (not NRND or EOL unless justified)
- [ ] Long-lead items flagged (FPGAs, some MCUs, specialty connectors can be 16+ weeks)
- [ ] LCSC preferred for passive components if JLCPCB assembly (reduces cost)

### Pricing

- [ ] Pricing validated at build quantity (not single-unit)
- [ ] Total BOM cost within project budget
- [ ] Reel minimums considered for SMT passives

### Package consistency

- [ ] Package matches PCB footprint exactly
- [ ] 0402 vs 0603 matches layout
- [ ] Polarized components (caps, LEDs, diodes) polarity marked

## Generating BOM from KiCad

```bash
# Export BOM from CLI
kicad-cli sch export bom \
  --output bom.csv \
  --fields "Reference,Value,Footprint,${MPN_FIELD}" \
  schematic.kicad_sch
```

Or use KiCad's BOM plugin system for richer output.

## Cost Estimation by Category

Rough starting points for prototype quantities (10-50 units):

| Category | Typical range |
|----------|-------------|
| MCU (ESP32, STM32) | $2–8 |
| Passives (full board) | $2–10 |
| Connectors | $1–20 depending on type |
| Power management IC | $0.50–5 |
| Sensors | $1–50+ |
| PCB fabrication (JLCPCB, 2-layer) | $5–30 for 10 boards |
| SMT assembly (JLCPCB) | $30–100 setup + $0.01–0.05/placement |

## Common Mistakes

- MPN not specific enough (no voltage rating, no temperature grade)
- No second source on MCU or power management IC
- Connector footprint doesn't match actual connector (check mating dimensions)
- Passive values from schematic don't account for DC bias derating on MLCC caps
