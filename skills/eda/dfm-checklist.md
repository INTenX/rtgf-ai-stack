---
skill_id: eda/dfm-checklist
domain: eda
trigger: DFM, design for manufacture, PCB manufacturing, assembly, JLCPCB, fabrication, Gerber
version: "1.0"
---

# Skill: Design for Manufacture Checklist

## Purpose

Verify a PCB design is manufacturable and assembleable before sending to fab. DFM issues caught here avoid costly respins.

## Fabrication Constraints (JLCPCB Standard 2-Layer)

| Parameter | Standard | Notes |
|-----------|----------|-------|
| Min trace width | 0.127mm (5mil) | 0.2mm for safety |
| Min trace spacing | 0.127mm (5mil) | 0.2mm for safety |
| Min via drill | 0.3mm | 0.4mm for safety |
| Min via annular ring | 0.15mm | |
| Board thickness | 1.6mm default | 0.8mm–2.0mm available |
| Copper weight | 1oz default | 2oz available at extra cost |
| Min hole to board edge | 0.3mm | |
| Min silkscreen width | 0.153mm | |

For 4-layer or impedance-controlled, verify constraints with fab directly.

## Fab Checklist

### Gerbers

- [ ] All copper layers exported (F.Cu, B.Cu, inner layers if 4+)
- [ ] Drill file included (PTH and NPTH separate if required)
- [ ] Edge cuts layer included and board outline closed
- [ ] Silkscreen layers included (F.Silkscreen, B.Silkscreen)
- [ ] Solder mask layers included (F.Mask, B.Mask)
- [ ] Paste layers included if SMT assembly (F.Paste, B.Paste)
- [ ] Gerbers visually inspected in Gerber viewer before upload
- [ ] No copper or silkscreen extending past board edge

### Design rules

- [ ] DRC passes with zero errors
- [ ] All unconnected nets resolved or intentionally unconnected (no-connect marker)
- [ ] Courtyard clearance — no overlapping component courtyards
- [ ] Board outline is a single closed polygon on Edge.Cuts

### Stackup and impedance

- [ ] If controlled impedance required, stackup spec provided to fab
- [ ] Differential pair spacing calculated for target impedance
- [ ] Reference plane solid under high-speed traces

## Assembly Checklist

### Component placement

- [ ] All SMT components on one side preferred for single-reflow (reduces cost)
- [ ] Through-hole components on opposite side from SMT where possible
- [ ] Tall components don't shadow adjacent SMT during reflow
- [ ] Fiducial marks present (≥3 for pick-and-place, placed on copper, not masked)
- [ ] Polarity marks on all polarized SMT components (diodes, electrolytic caps, ICs)

### Soldermask and paste

- [ ] Paste aperture not larger than pad (default paste shrink 10–20% is fine)
- [ ] No paste on fiducials
- [ ] Soldermask bridge between fine-pitch IC pads (0.1mm bridge prevents solder bridges)
- [ ] Test pads have mask opening

### Panelization (if applicable)

- [ ] V-score or tab-route specified
- [ ] Breakout tabs don't compromise board integrity
- [ ] All boards in panel same orientation

## JLCPCB SMT Assembly Notes

- JLCPCB prefers LCSC part numbers for standard library parts
- Extended library parts have additional setup fee ($3–5 per unique part)
- Confirm component orientation in their online preview before confirming order
- Provide top-side assembly placement CSV + BOM in their format
- Hand-solder QFN, BGA, or parts not in their library

## Common DFM Failures

- Via in pad without filled/capped via (solder wicks into via during reflow)
- Pad spacing too tight for wave solder on through-hole mixed board
- Silkscreen over solder pads (JLCPCB strips it but can affect readability)
- Asymmetric land pattern on dual-pad SMT causes tombstoning during reflow
- No thermal relief on through-hole pads in ground pour (hard to hand solder)
