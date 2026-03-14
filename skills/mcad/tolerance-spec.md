---
skill_id: mcad/tolerance-spec
domain: mcad
trigger: tolerance, stack-up, clearance, fit, GD&T, machining tolerance, 3D print tolerance
version: "1.0"
---

# Skill: Tolerance Specification and Stack-Up Analysis

## Purpose

Define correct tolerances for mechanical features and verify that the worst-case stack-up still produces an acceptable assembly. Prevents interference fits that won't assemble and loose fits that fail functionally.

## Tolerance by Manufacturing Process

| Process | Typical tolerance | Notes |
|---------|-----------------|-------|
| FDM 3D print | ±0.2–0.5mm | Varies by printer, orientation, material |
| SLA/MSLA resin | ±0.1–0.2mm | Better than FDM, check shrinkage |
| CNC machined aluminum | ±0.025–0.1mm | Depends on feature size and operation |
| CNC machined plastic | ±0.05–0.15mm | |
| Laser cut acrylic | ±0.1–0.2mm | Kerf width varies by thickness |
| Sheet metal bend | ±0.3–0.5mm | Bend angle ±1–2° typical |

## Fit Types

| Fit | Clearance | Use case |
|-----|-----------|---------|
| Clearance (free) | +0.3–0.5mm on diameter | Easy assembly, no precision needed |
| Clearance (close) | +0.1–0.2mm on diameter | Located but removable, hand assembly |
| Transition | +0.0–0.05mm | Press fit for plastic, light interference for metal |
| Interference | -0.01–0.05mm | Permanent metal press fit |

For 3D printed parts mating with 3D printed features:
- Hole diameter = nominal + 0.4mm (FDM)
- Slot width = nominal + 0.3mm (FDM)
- Peg/boss diameter = nominal - 0.2mm (FDM)

## Worst-Case Stack-Up Method

For a linear chain of N dimensions with tolerances t₁...tₙ:

```
Worst-case gap = nominal_gap - Σ(tᵢ)
```

Example: PCB (tol ±0.15) in slot (tol ±0.3), nominal gap 0.5mm each side:
- Worst case: 0.5 - 0.15 - 0.3 = 0.05mm clearance (tight but clears)
- If negative: interference — redesign

Statistical (RSS) method for assemblies with many parts:
```
Expected variation = √(t₁² + t₂² + ... + tₙ²)
```

Use RSS when N > 5 and all tolerances are independent.

## Checklist Before Finalizing Dimensions

- [ ] Critical interfaces have stack-up calculated
- [ ] Worst-case clearance ≥ 0mm (no interference in worst case)
- [ ] Press-fit features: interference calculated, force estimated
- [ ] All tolerances achievable by specified manufacturing process
- [ ] Tolerances tighter than process capability flagged for review
- [ ] DUT PCB tolerance included (PCB outline typically ±0.15mm from fab)

## Thermal Expansion Considerations

For fixtures that operate at elevated temperature:

```
ΔL = L × α × ΔT
```

| Material | α (CTE) |
|----------|---------|
| Aluminum 6061 | 23.6 µm/m·°C |
| PLA (3D print) | 68 µm/m·°C |
| ABS (3D print) | 73 µm/m·°C |
| FR4 PCB (in-plane) | 14–17 µm/m·°C |

For a 100mm aluminum fixture heating from 20°C to 60°C:
ΔL = 100 × 23.6e-6 × 40 = 0.094mm

If the fixture and PCB have different CTEs, the clearance changes with temperature. Design clearance to accommodate.

## Documentation Standard

Dimension notation on drawings:
- Critical dimensions: explicit tolerance (e.g. `15.00 ±0.05`)
- General dimensions: reference general tolerance block
- Stack-up calculations: include in design notes or separate stack-up spreadsheet

Always document which features are critical and why.
