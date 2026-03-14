---
skill_id: eda/circuit-review
domain: eda
trigger: schematic review, circuit review, EDA review, PCB review, design review, KiCad review
version: "1.0"
---

# Skill: Circuit Review Workflow

## Purpose

Structured approach to reviewing schematics and PCB layouts. Catches functional, safety, and manufacturability issues before fabrication. Applies to KiCad projects and exported Gerbers.

## Review Levels

| Level | Scope | When |
|-------|-------|------|
| Quick check | Power, critical signals, obvious errors | Before sending to collaborator |
| Full schematic review | All nets, decoupling, protection, annotations | Before PCB layout |
| Layout review | Clearances, stackup, thermal, EMC | Before Gerber generation |
| Pre-fab check | DRC clean, Gerber visual inspection, BOM complete | Before ordering |

## Schematic Review Checklist

### Power

- [ ] All power nets have decoupling caps (100nF ceramic + 10µF bulk per IC minimum)
- [ ] Power rail names consistent across hierarchy sheets
- [ ] LDO/regulator has correct input/output caps per datasheet
- [ ] Reverse polarity protection on input power (Schottky diode or P-FET)
- [ ] Power-on LED or test point on each rail
- [ ] No floating power pins (tie to rail or GND with note)

### Digital signals

- [ ] I2C lines have pull-ups (4.7kΩ typical at 3.3V/400kHz)
- [ ] SPI CS lines pulled high at startup
- [ ] UART TX/RX not crossed incorrectly
- [ ] GPIO boot-mode pins have defined states (pull-up or pull-down)
- [ ] Reset line has RC filter or debounce

### Protection

- [ ] ESD protection on all external-facing connectors
- [ ] Current limiting on LEDs (check resistor values)
- [ ] Fuse or polyfuse on input power
- [ ] Overvoltage clamping on analog inputs

### Annotations and hygiene

- [ ] All components have values
- [ ] Reference designators sequential and unique
- [ ] No unconnected pins without explicit PWR_FLAG or no-connect marker
- [ ] Hierarchical labels match across sheets
- [ ] Net names descriptive (not generic like "Net001")

## Layout Review Checklist

### Placement

- [ ] Decoupling caps within 1mm of IC power pins
- [ ] Oscillator/crystal close to IC, away from high-current traces
- [ ] Connectors placed for mechanical clearance and assembly access
- [ ] Test points accessible with board in enclosure

### Routing

- [ ] Power traces sized for current (1A ≈ 0.3mm at 10°C rise as starting point)
- [ ] High-speed signals direct, no stubs
- [ ] Differential pairs matched length
- [ ] No acute angles (45° or curved)

### Ground

- [ ] Solid ground pour on inner or bottom layer
- [ ] Thermal reliefs on through-hole pads in pour
- [ ] Split ground planes bridged at single point if mixed analog/digital

### DRC

- [ ] DRC clean — no errors, no warnings unreviewed
- [ ] 3D model check — no collisions

## KiCad-Specific Notes

```bash
# Run ERC from CLI
kicad-cli sch erc --output erc-report.txt schematic.kicad_sch

# Run DRC from CLI
kicad-cli pcb drc --output drc-report.txt board.kicad_pcb

# Generate Gerbers
kicad-cli pcb export gerbers --output gerbers/ board.kicad_pcb
```

## Common Mistakes (from CHRONICLE patterns)

- Decoupling caps on wrong side of via (cap must be between via and IC pin)
- 5V signal into 3.3V GPIO without level shifting
- I2C pull-ups to wrong voltage rail
- Missing BOOT0/BOOT1 configuration for STM32
- Connector pinout matches cable convention, not PCB silk convention
