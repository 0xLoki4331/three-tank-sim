// Three-tank process model: plant presets, nonlinear physics, RK4 integrator, PID, simulation engine.
// Pure JS (no React) so it runs headless in Node for tests and analysis.
// Units internally: SI (m, m², m³/s, s). Controllers work in cm and % OP.

export const G = 9.81
export const DT = 0.05 // integration step [s]
export const TS = 0.1 // controller sample time [s]
const CTRL_EVERY = Math.round(TS / DT)
const REC = 0.25 // history sample period [s]
const HIST_MAX = 60000
const BAND = 1e-3 // m — linear band around Δh = 0 so sign()·√|Δh| has finite slope (no chatter)

// ---------------------------------------------------------------------------------------------
// Plant presets. Layout fields (x, base, hpx, side) only drive the SVG mimic.
// DTS200 values follow the Amira DTS200 benchmark: A = 0.0154 m², Sn = 5e-5 m², hmax = 0.62 m,
// Qmax = 100 mL/s, outflow coefficients μ13 = μ32 = 0.5, μ20 = 0.6 (typical literature values).
// ---------------------------------------------------------------------------------------------
const leak = (i) => ({ tag: `HV-L${i + 1}`, from: i, to: null, law: 'drain', Cd: 0.6, a: 3e-5, valve: 0, leak: true })

export const PRESETS = {
  dts200: {
    name: 'DTS200 benchmark',
    short: 'MIMO · 2 pumps · 2 loops',
    desc: 'Amira DTS200 laboratory three-tank system. Pumps P-101 and P-102 feed the outer tanks T-1 and T-2; T-3 sits between them, coupled through bottom pipes. T-2 drains to the reservoir. Two coupled level loops make it a 2×2 MIMO problem.',
    view: { w: 1060, h: 520 },
    tanks: [
      { tag: 'T-1', A: 0.0154, hmax: 0.62, x: 170, base: 410, hpx: 290 },
      { tag: 'T-2', A: 0.0154, hmax: 0.62, x: 690, base: 410, hpx: 290 },
      { tag: 'T-3', A: 0.0154, hmax: 0.62, x: 430, base: 410, hpx: 290 },
    ],
    pipes: [
      { tag: 'HV-13', from: 0, to: 2, law: 'interact', Cd: 0.5, a: 5e-5, valve: 100 },
      { tag: 'HV-32', from: 2, to: 1, law: 'interact', Cd: 0.5, a: 5e-5, valve: 100 },
      { tag: 'HV-20', from: 1, to: null, law: 'drain', Cd: 0.6, a: 5e-5, valve: 100 },
      leak(0), leak(1), leak(2),
    ],
    pumps: [
      { tag: 'P-101', tank: 0, Qmax: 1e-4, side: 'left' },
      { tag: 'P-102', tank: 1, Qmax: 1e-4, side: 'right' },
    ],
    loops: [
      { tag: 'LIC-101', tank: 0, pump: 0, sp: 40, Kc: 10, Ti: 60, Td: 0 },
      { tag: 'LIC-102', tank: 1, pump: 1, sp: 20, Kc: 10, Ti: 60, Td: 0 },
    ],
  },
  series: {
    name: 'A · Non-interacting series',
    short: 'SISO · cascade · 3rd order',
    desc: 'Three tanks in cascade. Each tank discharges freely into the one below, so its outflow depends only on its own level (q = Cd·a·√(2gh)). Pump P-101 feeds T-1; LIC-103 controls the level in T-3. Three first-order lags in series.',
    view: { w: 1000, h: 640 },
    tanks: [
      { tag: 'T-1', A: 0.0154, hmax: 0.62, x: 170, base: 200, hpx: 150 },
      { tag: 'T-2', A: 0.0154, hmax: 0.62, x: 430, base: 385, hpx: 150 },
      { tag: 'T-3', A: 0.0154, hmax: 0.62, x: 690, base: 570, hpx: 150 },
    ],
    pipes: [
      { tag: 'HV-12', from: 0, to: 1, law: 'free', Cd: 0.6, a: 3e-5, valve: 100 },
      { tag: 'HV-23', from: 1, to: 2, law: 'free', Cd: 0.6, a: 3e-5, valve: 100 },
      { tag: 'HV-30', from: 2, to: null, law: 'drain', Cd: 0.6, a: 3e-5, valve: 100 },
      leak(0), leak(1), leak(2),
    ],
    pumps: [{ tag: 'P-101', tank: 0, Qmax: 1e-4, side: 'left' }],
    loops: [{ tag: 'LIC-103', tank: 2, pump: 0, sp: 20, Kc: 1.5, Ti: 300, Td: 0 }],
  },
  interacting: {
    name: 'B · Interacting series',
    short: 'SISO · coupled · 3rd order',
    desc: 'Three tanks at the same elevation joined at the bottom. Flow between tanks depends on the level difference (q = Cd·a·sign(Δh)·√(2g|Δh|)), so downstream levels push back on upstream ones. Pump P-101 feeds T-1; LIC-103 controls T-3.',
    view: { w: 1000, h: 520 },
    tanks: [
      { tag: 'T-1', A: 0.0154, hmax: 0.62, x: 170, base: 410, hpx: 290 },
      { tag: 'T-2', A: 0.0154, hmax: 0.62, x: 430, base: 410, hpx: 290 },
      { tag: 'T-3', A: 0.0154, hmax: 0.62, x: 690, base: 410, hpx: 290 },
    ],
    pipes: [
      { tag: 'HV-12', from: 0, to: 1, law: 'interact', Cd: 0.6, a: 6e-5, valve: 100 },
      { tag: 'HV-23', from: 1, to: 2, law: 'interact', Cd: 0.6, a: 6e-5, valve: 100 },
      { tag: 'HV-30', from: 2, to: null, law: 'drain', Cd: 0.6, a: 3e-5, valve: 100 },
      leak(0), leak(1), leak(2),
    ],
    pumps: [{ tag: 'P-101', tank: 0, Qmax: 1e-4, side: 'left' }],
    loops: [{ tag: 'LIC-103', tank: 2, pump: 0, sp: 20, Kc: 2, Ti: 250, Td: 0 }],
  },
}

// ---------------------------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------------------------
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const sroot = (d) => (Math.abs(d) < BAND ? d / Math.sqrt(BAND) : Math.sign(d) * Math.sqrt(Math.abs(d)))

/** Volumetric flow through one pipe [m³/s], positive in from→to direction. */
export function pipeFlow(p, h) {
  const k = p.Cd * p.a * (p.valve / 100) * Math.sqrt(2 * G)
  const hi = Math.max(h[p.from], 0)
  if (p.law === 'interact') return k * sroot(hi - Math.max(h[p.to], 0))
  return k * sroot(hi) // 'free' (discharges above downstream surface) or 'drain' (to reservoir)
}

/** Pump flow [m³/s] from OP [%]. */
export const pumpFlow = (pm, op) => (pm.failed ? 0 : (clamp(op, 0, 100) / 100) * pm.Qmax)

/** dh/dt for every tank. u = pump OPs [%]. P.qd = inflow disturbance per tank [m³/s]. */
export function deriv(h, u, P) {
  const q = P.tanks.map((_, i) => P.qd?.[i] ?? 0)
  P.pumps.forEach((pm, j) => (q[pm.tank] += pumpFlow(pm, u[j])))
  for (const p of P.pipes) {
    const f = pipeFlow(p, h)
    q[p.from] -= f
    if (p.to != null) q[p.to] += f
  }
  return q.map((qi, i) => {
    const d = qi / P.tanks[i].A
    if (h[i] >= P.tanks[i].hmax && d > 0) return 0 // overflow: excess spills to reservoir
    if (h[i] <= 0 && d < 0) return 0 // empty
    return d
  })
}

export function rk4(h, u, P, dt) {
  const f = (x) => deriv(x, u, P)
  const add = (a, b, s) => a.map((v, i) => v + b[i] * s)
  const k1 = f(h)
  const k2 = f(add(h, k1, dt / 2))
  const k3 = f(add(h, k2, dt / 2))
  const k4 = f(add(h, k3, dt))
  return h.map((v, i) => clamp(v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]), 0, P.tanks[i].hmax))
}

// ---------------------------------------------------------------------------------------------
// PID — ISA standard form  u = Kc·[ e + (1/Ti)∫e dt + Td·dPV/dt ]  (derivative on PV, filtered)
// Kc [%/cm], Ti [s] (0 = no integral, P-only with manual reset), Td [s].
// ---------------------------------------------------------------------------------------------
export class PID {
  constructor({ Kc = 1, Ti = 0, Td = 0 } = {}) {
    Object.assign(this, { Kc, Ti, Td, aw: true, I: 0, D: 0, prev: null })
  }
  update(sp, pv, dt, mode, manOp) {
    const e = sp - pv
    const P = this.Kc * e
    if (this.prev == null) this.prev = pv
    const Tf = this.Td / 10 // derivative filter, N = 10
    this.D = this.Td > 0 ? (Tf * this.D - this.Kc * this.Td * (pv - this.prev)) / (Tf + dt) : 0
    this.prev = pv
    if (mode === 'MAN') {
      this.I = manOp - P - this.D // integrator tracks → bumpless MAN→AUTO
      return manOp
    }
    const I = this.I + (this.Ti > 0 ? ((this.Kc * dt) / this.Ti) * e : 0)
    const raw = P + I + this.D
    const out = clamp(raw, 0, 100)
    // anti-windup (conditional integration): freeze I while saturated and error pushes further into saturation
    if (!this.aw || raw === out || Math.sign(raw - out) !== Math.sign(this.Kc * e)) this.I = I
    return out
  }
}

function gauss() {
  let u = 0
  while (!u) u = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random())
}

// ---------------------------------------------------------------------------------------------
// Simulation engine
// ---------------------------------------------------------------------------------------------
export class Sim {
  constructor(key = 'dts200') {
    this.load(key)
  }

  load(key) {
    this.key = key
    const P = structuredClone(PRESETS[key])
    P.qd = P.tanks.map(() => 0)
    this.P = P
    this.h = P.tanks.map(() => 0)
    this.t = 0
    this.k = 0
    this.noise = 0 // sensor noise σ [cm]
    this.record = true
    this.loops = P.loops.map((l) => ({
      ...l,
      mode: 'AUTO',
      out: 0,
      meas: 0,
      pid: new PID(l),
      evt: { t0: 0, from: 0, to: l.sp },
    }))
    this.resetHistory()
  }

  resetHistory() {
    this.lastRec = -Infinity
    this.hist = {
      t: [],
      h: this.P.tanks.map(() => []),
      sp: this.loops.map(() => []),
      pv: this.loops.map(() => []),
      op: this.loops.map(() => []),
    }
  }

  /** Pump OPs [%], indexed by pump. A pump with no loop runs at 0. */
  u() {
    const u = this.P.pumps.map(() => 0)
    for (const L of this.loops) u[L.pump] = L.out
    return u
  }

  step() {
    if (this.k++ % CTRL_EVERY === 0) {
      for (const L of this.loops) {
        L.meas = this.h[L.tank] * 100 + (this.noise ? this.noise * gauss() : 0)
        L.out = L.pid.update(L.sp, L.meas, TS, L.mode, L.out)
      }
    }
    this.h = rk4(this.h, this.u(), this.P, DT)
    this.t += DT
    if (this.record && this.t - this.lastRec >= REC - 1e-9) this.sample()
  }

  sample() {
    const H = this.hist
    this.lastRec = this.t
    H.t.push(this.t)
    this.h.forEach((v, i) => H.h[i].push(v * 100))
    this.loops.forEach((L, j) => {
      H.sp[j].push(L.sp)
      H.pv[j].push(L.meas)
      H.op[j].push(L.out)
    })
    if (H.t.length > HIST_MAX) {
      const n = HIST_MAX / 10
      H.t.splice(0, n)
      for (const g of [H.h, H.sp, H.pv, H.op]) g.forEach((a) => a.splice(0, n))
    }
  }

  /** Advance by simSeconds (fixed steps). Caller caps simSeconds per frame. */
  run(simSeconds) {
    const n = Math.round(simSeconds / DT)
    for (let i = 0; i < n; i++) this.step()
  }

  /** Real-time driver: accumulates fractional steps so 1× works at any frame rate. */
  advance(simSeconds) {
    this.acc = (this.acc || 0) + simSeconds
    const n = Math.min(Math.floor(this.acc / DT + 1e-9), 4000) // cap: ≈200 s of sim per frame
    for (let i = 0; i < n; i++) this.step()
    this.acc = n === 4000 ? 0 : this.acc - n * DT
  }

  setSP(j, v) {
    const L = this.loops[j]
    L.evt = { t0: this.t, from: this.h[L.tank] * 100, to: v }
    L.sp = v
  }

  /** All pipe flows [mL/s] for display. */
  flows() {
    return this.P.pipes.map((p) => pipeFlow(p, this.h) * 1e6)
  }

  /** Independent copy for headless analysis (no history, no noise). */
  clone() {
    const s = new Sim(this.key)
    s.P = structuredClone(this.P)
    s.h = [...this.h]
    s.record = false
    s.loops = this.loops.map((L) => ({ ...L, pid: Object.assign(new PID(), L.pid) }))
    return s
  }
}
