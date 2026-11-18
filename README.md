# Three-Tank System Simulator

Interactive process-control simulator of a three-tank level system, built with React and Vite. It has three plant presets:

| Preset | Structure | Control |
|---|---|---|
| **DTS200 benchmark** (default) | P-101 → T-1 ⇄ T-3 ⇄ T-2 → drain, P-102 → T-2 | 2×2 MIMO: LIC-101 (h1), LIC-102 (h2) |
| **A · Non-interacting series** | T-1 → T-2 → T-3 cascade, free discharge | SISO: LIC-103 (h3) via P-101 |
| **B · Interacting series** | T-1 ⇄ T-2 ⇄ T-3, bottom-connected | SISO: LIC-103 (h3) via P-101 |

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # physics/controller self-checks (Node, no framework)
npm run build    # static build in dist/
```

## Model

Each tank follows a mass balance, and each pipe follows Torricelli's law:

```
A·dh_i/dt = Σ q_in − Σ q_out
q_ij = Cd·a·(v/100)·sign(h_i − h_j)·√(2g|h_i − h_j|)   (interacting)
q_i  = Cd·a·(v/100)·√(2g·h_i)                          (free discharge / drain / leak)
Q_j  = OP_j/100 · Q_max
```

- **Integration:** fixed-step RK4 with Δt = 50 ms. Levels clamp at 0 and at h_max (the tank overflows).
- **Square-root law near Δh = 0:** linearised over ±1 mm so the slope stays finite.
- **PID:** ISA standard form, sampled every 100 ms. Derivative acts on the PV with a filter (N = 10), so setpoint changes cause no derivative kick. Anti-windup uses conditional integration. MAN→AUTO transfer is bumpless because the integrator tracks the output while in manual.
- **DTS200 parameters:** A = 154 cm², pipe area 0.5 cm², h_max = 62 cm, Q_max = 100 mL/s, μ13 = μ32 = 0.5, μ20 = 0.6. These are the typical literature values; check them against your course reference.

Code layout:
- `src/sim/model.js`: physics and PID.
- `src/sim/analysis.js`: identification, tuning rules, linearisation, metrics.
- Both are pure JS, and `npm test` exercises them.

## Features

- **Process mimic.** Animated flows, ISA tags, HI/HIHI level alarms, and clickable valves and pumps (open or close a valve, trip a pump).
- **Faceplates.** PV, SP, OP and AUTO/MAN for each loop; Kc / Ti / Td and anti-windup are editable live; quick metrics for the last setpoint step.
- **Trends.** Levels with setpoints, and controller outputs. Window from 2 min to all history. Pause to drag-zoom.
- **Disturbances and faults.** Inflow disturbance, leaks, valve blockage, pump trip, sensor noise, plus one-click scenarios.
- **Tuning lab.** Both tests run on a copy of the plant, so the live process isn't disturbed.
  - Open-loop step test with a FOPDT fit (two-point method), then Ziegler–Nichols, Cohen–Coon, SIMC and IMC tunings.
  - Relay auto-tune (Åström–Hägglund) for Ku and Pu, then ZN closed-loop and Tyreus–Luyben tunings.
  - One-click **Apply** for any suggested tuning.
- **Performance.** Rise time, overshoot, peak time, 2 % settling time, IAE, ISE and steady-state error for each setpoint step. Save runs into a comparison table.
- **Linear model.**
  - A and B matrices from a numerical Jacobian at the operating point.
  - Poles and time constants.
  - Full transfer-function matrix (Faddeev–LeVerrier).
  - RGA for the DTS200 pairing.
  - A plot of the linear model against the nonlinear step response.
- **Model & parameters.** The ODEs generated for the selected preset, with editable A, Cd, a and Q_max.
- **Other:** CSV export of the full history, light (ISA-101 grey) and dark themes, speeds from 1× to 200×.

## Demo script (≈5 min)

1. **DTS200 at 200×:** the tanks fill and both loops settle. Point out the interaction: P-101 also raises h2 through T-3.
2. **Disturbances → Leak in T-3:** the loops reject it, and OP rises to compensate.
3. **Trip P-102:** LIC-102 saturates and the SAT alarm appears. Restore the pump and watch the recovery on the trend. Repeat with anti-windup off on LIC-102 and compare the overshoot on the trend.
   Relay auto-tune on LIC-101 is a good teaching moment: the loop is effectively first order, so the app flags the result as hysteresis-dominated.
4. **Preset A:** step SP 20 → 30. The response is slow and third-order. Tuning lab → step test shows the apparent dead time θ. Apply SIMC and compare runs in Performance.
5. **Linear model:** three equal time constants (τ = 2Ah/Q). Set ΔOP = 30 % to show where the linearisation breaks down.
6. **Preset B:** the same plant with interaction. The poles spread apart; compare with A.
