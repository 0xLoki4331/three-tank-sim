// Analysis tools: step-test identification (FOPDT), tuning rules, relay auto-tune,
// linearisation + transfer functions, closed-loop performance metrics, CSV export.
import { deriv, clamp, DT, makeFilter } from './model.js'

/** Hold current OPs until levels stop moving. */
export function settle(s, maxT = 6000) {
  let last = [...s.h]
  for (let t = 0; t < maxT; t += 20) {
    s.run(20)
    const d = Math.max(...s.h.map((v, i) => Math.abs(v - last[i])))
    last = [...s.h]
    if (d < 2e-6) break
  }
}

// ---------------------------------------------------------------- step test + FOPDT fit
/** Open-loop step test on loop li, run on a copy of the plant. Other loops keep their mode. */
export function stepTest(sim, li, dOp, maxT = 4000) {
  const s = sim.clone()
  const L = s.loops[li]
  L.mode = 'MAN'
  settle(s)
  const y0 = s.h[L.tank] * 100
  const op0 = L.out
  if (Math.abs(clamp(op0 + dOp, 0, 100) - op0) < Math.abs(dOp) / 2) dOp = -dOp // near a limit: step the other way
  L.out = clamp(op0 + dOp, 0, 100)
  const du = L.out - op0
  const t = [0]
  const y = [y0]
  for (let k = 1; k * 2 <= maxT; k++) {
    s.run(2)
    t.push(k * 2)
    y.push(s.h[L.tank] * 100)
    const n = y.length
    if (k > 150 && Math.abs(y[n - 1] - y[n - 101]) < 0.002 * Math.abs(y[n - 1] - y0) + 1e-4) break
  }
  const hmax = s.P.tanks[L.tank].hmax * 100
  const clipped = Math.max(...y, y0) >= 0.99 * hmax || Math.min(...y, y0) <= 0.01
  return { t, y, y0, op0, du, clipped, fit: clipped ? null : fitFOPDT(t, y, y0, du) }
}

/** Two-point (Smith) method: t28 and t63 → τ = 1.5(t63 − t28), θ = t63 − τ. */
export function fitFOPDT(t, y, y0, du) {
  const yinf = y[y.length - 1]
  const dy = yinf - y0
  if (!du || Math.abs(dy) < 1e-3) return null
  const cross = (f) => {
    const target = y0 + f * dy
    for (let i = 1; i < y.length; i++)
      if ((y[i] - target) * Math.sign(dy) >= 0) {
        const r = (target - y[i - 1]) / (y[i] - y[i - 1] || 1)
        return t[i - 1] + r * (t[i] - t[i - 1])
      }
    return t[t.length - 1]
  }
  const t28 = cross(0.283)
  const t63 = cross(0.632)
  const tau = 1.5 * (t63 - t28)
  const thetaRaw = t63 - tau
  const theta = Math.max(thetaRaw, 1, 0.02 * tau) // floor: θ→0 makes ZN/CC blow up
  return { K: dy / du, tau, theta, thetaRaw, small: thetaRaw < 0.1 * tau, t28, t63 }
}

export const fopdt = ({ K, tau, theta }, du, y0) => (t) => (t <= theta ? y0 : y0 + K * du * (1 - Math.exp(-(t - theta) / tau)))

/** Classic tuning correlations from an FOPDT model. Kc in %/cm. */
export function tuningRules({ K, tau, theta: th }) {
  const r = th / tau
  const lam = Math.max(th, 0.2 * tau)
  return [
    { rule: 'Ziegler–Nichols', kind: 'P', Kc: tau / (K * th), Ti: 0, Td: 0 },
    { rule: 'Ziegler–Nichols', kind: 'PI', Kc: (0.9 * tau) / (K * th), Ti: 3.33 * th, Td: 0 },
    { rule: 'Ziegler–Nichols', kind: 'PID', Kc: (1.2 * tau) / (K * th), Ti: 2 * th, Td: 0.5 * th },
    { rule: 'Cohen–Coon', kind: 'P', Kc: (1 / K) * (1 / r) * (1 + r / 3), Ti: 0, Td: 0 },
    { rule: 'Cohen–Coon', kind: 'PI', Kc: (1 / K) * (1 / r) * (0.9 + r / 12), Ti: (th * (30 + 3 * r)) / (9 + 20 * r), Td: 0 },
    { rule: 'Cohen–Coon', kind: 'PID', Kc: (1 / K) * (1 / r) * (4 / 3 + r / 4), Ti: (th * (32 + 6 * r)) / (13 + 8 * r), Td: (4 * th) / (11 + 2 * r) },
    { rule: 'SIMC (τc = θ)', kind: 'PI', Kc: tau / (K * 2 * th), Ti: Math.min(tau, 8 * th), Td: 0 },
    { rule: `IMC (λ = ${lam.toFixed(0)} s)`, kind: 'PID', Kc: (tau + th / 2) / (K * (lam + th / 2)), Ti: tau + th / 2, Td: (tau * th) / (2 * tau + th) },
  ]
}

// ---------------------------------------------------------------- relay auto-tune (Åström–Hägglund)
export function relayTest(sim, li, d = 10, eps = 0.2, maxT = 8000) {
  const s = sim.clone()
  const L = s.loops[li]
  L.mode = 'MAN'
  settle(s)
  const sp = s.h[L.tank] * 100
  const op0 = L.out
  const amp = Math.max(0.5, Math.min(d, op0, 100 - op0))
  let up = true
  const ups = []
  const t = []
  const y = []
  const u = []
  for (let k = 0; k * DT < maxT; k++) {
    const pv = s.h[L.tank] * 100
    const e = sp - pv
    if (!up && e > eps) {
      up = true
      ups.push(k * DT)
    } else if (up && e < -eps) up = false
    L.out = clamp(op0 + (up ? amp : -amp), 0, 100)
    s.step()
    if (k % 20 === 0) {
      t.push(k * DT)
      y.push(pv)
      u.push(L.out)
    }
    if (ups.length >= 8) break
  }
  if (ups.length < 4) return { t, y, u, sp, ok: false }
  const per = ups.slice(-4).map((v, i, a) => (i ? v - a[i - 1] : null)).slice(1)
  const Pu = per.reduce((a, b) => a + b, 0) / per.length
  const tail = y.filter((_, i) => t[i] >= ups[ups.length - 3])
  const a = (Math.max(...tail) - Math.min(...tail)) / 2
  const Ku = (4 * amp) / (Math.PI * Math.sqrt(Math.max(a * a - eps * eps, 1e-9)))
  return {
    t, y, u, sp, ok: true, Ku, Pu, a, amp,
    // a ≈ ε → oscillation set by the hysteresis band, not the process phase lag (relative degree 1 loop)
    hyst: a < 1.5 * eps,
    rules: [
      { rule: 'ZN closed-loop', kind: 'P', Kc: 0.5 * Ku, Ti: 0, Td: 0 },
      { rule: 'ZN closed-loop', kind: 'PI', Kc: 0.45 * Ku, Ti: Pu / 1.2, Td: 0 },
      { rule: 'ZN closed-loop', kind: 'PID', Kc: 0.6 * Ku, Ti: Pu / 2, Td: Pu / 8 },
      { rule: 'Tyreus–Luyben', kind: 'PI', Kc: 0.31 * Ku, Ti: 2.2 * Pu, Td: 0 },
      { rule: 'Tyreus–Luyben', kind: 'PID', Kc: 0.45 * Ku, Ti: 2.2 * Pu, Td: Pu / 6.3 },
    ],
  }
}

// ---------------------------------------------------------------- linearisation
const matMul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)))
const eye = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)))

/** Faddeev–LeVerrier: char. polynomial (descending) and adj(sI−A) = Σ M_k s^(n−k). */
export function leverrier(A) {
  const n = A.length
  const p = [1]
  const Ms = []
  let M = A.map((r) => r.map(() => 0))
  for (let k = 1; k <= n; k++) {
    M = matMul(A, M).map((r, i) => r.map((v, j) => v + (i === j ? p[k - 1] : 0)))
    Ms.push(M)
    const AM = matMul(A, M)
    p.push(-AM.reduce((s, r, i) => s + r[i], 0) / k)
  }
  return { p, Ms }
}

/** Polynomial roots (descending coeffs) via Durand–Kerner. Returns [re, im] pairs. */
export function roots(c) {
  let i0 = 0
  const big = Math.max(...c.map(Math.abs))
  while (i0 < c.length - 1 && Math.abs(c[i0]) < 1e-12 * big) i0++
  const a = c.slice(i0).map((v) => v / c[i0])
  const n = a.length - 1
  if (n < 1) return []
  const R = Math.max(1, ...a.slice(1).map(Math.abs)) // root radius bound
  let z = Array.from({ length: n }, (_, k) => [R * Math.cos(0.4 + (2 * Math.PI * k) / n), R * Math.sin(0.4 + (2 * Math.PI * k) / n)])
  const mul = (x, y) => [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]]
  const div = (x, y) => {
    const d = y[0] * y[0] + y[1] * y[1] || 1e-300
    return [(x[0] * y[0] + x[1] * y[1]) / d, (x[1] * y[0] - x[0] * y[1]) / d]
  }
  for (let it = 0; it < 500; it++) {
    z = z.map((zi, i) => {
      let pv = [1, 0] // Horner: p(zi)
      for (let k = 1; k <= n; k++) pv = mul(pv, zi), (pv[0] += a[k])
      let den = [1, 0]
      z.forEach((zj, j) => j !== i && (den = mul(den, [zi[0] - zj[0], zi[1] - zj[1]])))
      const dz = div(pv, den)
      return [zi[0] - dz[0], zi[1] - dz[1]]
    })
  }
  return z.map(([re, im]) => [re, Math.abs(im) < 1e-3 * (Math.abs(re) + 1e-12) ? 0 : im]) // repeated roots leave tiny spurious im
}

/**
 * Linearise around the steady state reached at the current pump OPs.
 * States x = levels [cm], inputs u = pump OPs [%].  dx/dt = A x + B u.
 */
export function linearize(sim) {
  const s = sim.clone()
  const u = s.u() // freeze the actual pump OPs and bypass the decoupler → model of the bare plant
  s.loops.forEach((L) => ((L.mode = 'MAN'), (L.out = u[L.pump])))
  s.dec.mode = 'off'
  settle(s)
  const P = s.P
  const h0 = [...s.h]
  const u0 = s.u()
  const n = h0.length
  const m = u0.length
  const f = (h, u) => deriv(h, u, P)
  const A = h0.map(() => Array(n).fill(0))
  const B = h0.map(() => Array(m).fill(0))
  for (let j = 0; j < n; j++) {
    const e = 1e-5
    const hp = [...h0]
    const hm = [...h0]
    hp[j] += e
    hm[j] = Math.max(0, hm[j] - e)
    const fp = f(hp, u0)
    const fm = f(hm, u0)
    for (let i = 0; i < n; i++) A[i][j] = (fp[i] - fm[i]) / (hp[j] - hm[j])
  }
  for (let j = 0; j < m; j++) {
    const up = [...u0]
    const um = [...u0]
    up[j] += 0.5
    um[j] -= 0.5
    const fp = f(h0, up)
    const fm = f(h0, um)
    for (let i = 0; i < n; i++) B[i][j] = (100 * (fp[i] - fm[i])) / (up[j] - um[j]) // cm/s per %
  }
  const { p, Ms } = leverrier(A)
  const poles = roots(p)
  const tf = []
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      const num = Ms.map((M) => matMul(M, B)[i][j])
      const K = num[n - 1] / p[n]
      // normalise so the denominator constant term is 1 → coefficients in s^k (seconds^k)
      tf.push({ out: i, inp: j, K, num: num.map((v) => v / p[n]), den: p.map((v) => v / p[n]), zeros: roots(num) })
    }
  return { A, B, h0: h0.map((v) => v * 100), u0, poles, tau: poles.map(([re]) => -1 / re), tf, sim: s }
}

/**
 * Decoupler design from the linear model (Seborg et al., simplified decoupling).
 *   static:  D12 = −K12/K11,        D21 = −K21/K22         (steady-state gains only)
 *   dynamic: D12(s) = −G12/G11,     D21(s) = −G21/G22      (ideal; all Gij share one denominator,
 *            so this is −num12/num11 — realisable when num_ii has degree ≥ num_ij and stable zeros)
 */
export function designDecoupler(sim) {
  const lin = linearize(sim)
  const g = (L, pump) => lin.tf.find((t) => t.out === L.tank && t.inp === pump)
  const [a, b] = sim.loops
  const G11 = g(a, a.pump), G12 = g(a, b.pump), G21 = g(b, a.pump), G22 = g(b, b.pump)
  const [K11, K12, K21, K22] = [G11.K, G12.K, G21.K, G22.K]
  const minPhase = (G) => G.zeros.every(([re]) => re < 0)
  const f12 = minPhase(G11) ? makeFilter(G12.num.map((v) => -v), G11.num) : null
  const f21 = minPhase(G22) ? makeFilter(G21.num.map((v) => -v), G22.num) : null
  return {
    D12: -K12 / K11,
    D21: -K21 / K22,
    f12,
    f21,
    num: { n12: G12.num, m12: G11.num, n21: G21.num, m21: G22.num },
    K: [[K11, K12], [K21, K22]],
    Kd: [K11 - (K12 * K21) / K22, K22 - (K21 * K12) / K11], // apparent diagonal gains, static decoupler
    at: lin.h0,
    designed: true,
  }
}

/** Open-loop step of pump j by dOp from the linearisation point: nonlinear vs linear response. */
export function compareStep(lin, j, dOp, T = 3000) {
  const s = lin.sim.clone()
  const n = lin.A.length
  const base = s.loops.find((L) => L.pump === j)
  const du = base ? clamp(base.out + dOp, 0, 100) - base.out : 0
  if (base) base.out += du
  let x = Array(n).fill(0)
  const t = []
  const nl = Array.from({ length: n }, () => [])
  const li = Array.from({ length: n }, () => [])
  const h = 1
  for (let k = 0; k * h <= T; k++) {
    t.push(k * h)
    s.h.forEach((v, i) => nl[i].push(v * 100))
    x.forEach((v, i) => li[i].push(lin.h0[i] + v))
    s.run(h)
    // RK4 on the linear model
    const f = (z) => lin.A.map((r, i) => r.reduce((a, v, c) => a + v * z[c], 0) + lin.B[i][j] * du)
    const add = (a, b, c) => a.map((v, i) => v + b[i] * c)
    const k1 = f(x), k2 = f(add(x, k1, h / 2)), k3 = f(add(x, k2, h / 2)), k4 = f(add(x, k3, h))
    x = x.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
  }
  return { t, nl, li, du }
}

// ---------------------------------------------------------------- performance metrics
/** Setpoint-step metrics for loop j measured from the last SP change (noise-free level). */
export function metrics(sim, j) {
  const L = sim.loops[j]
  const { t0, from, to } = L.evt
  const H = sim.hist
  const span = to - from
  let i0 = H.t.findIndex((v) => v >= t0)
  if (i0 < 0 || Math.abs(span) < 0.05) return null
  const tt = H.t
  const y = H.h[L.tank]
  const sp = H.sp[j]
  let t10 = null, t90 = null, peak = -Infinity, tPeak = null, lastOut = null, iae = 0, ise = 0
  // interaction: worst deviation of the *other* loop from its setpoint after this step (2×2 only)
  const ok = sim.loops.length === 2 ? 1 - j : null
  const yo = ok != null ? H.h[sim.loops[ok].tank] : null
  let cross = ok != null ? 0 : null
  for (let i = i0; i < tt.length; i++) {
    if (yo) cross = Math.max(cross, Math.abs(H.sp[ok][i] - yo[i]))
    const r = (y[i] - from) / span
    if (t10 == null && r >= 0.1) t10 = tt[i]
    if (t90 == null && r >= 0.9) t90 = tt[i]
    if (r > peak) (peak = r), (tPeak = tt[i])
    if (Math.abs(r - 1) > 0.02) lastOut = i
    if (i > i0) {
      const dt = tt[i] - tt[i - 1]
      const e = sp[i] - y[i]
      iae += Math.abs(e) * dt
      ise += e * e * dt
    }
  }
  const last = tt.length - 1
  return {
    rise: t10 != null && t90 != null ? t90 - t10 : null,
    overshoot: Math.max(0, (peak - 1) * 100),
    tPeak: tPeak != null ? tPeak - t0 : null,
    settling: lastOut == null ? 0 : lastOut < last - 4 ? tt[lastOut + 1] - t0 : null,
    iae,
    ise,
    elapsed: tt[last] - t0,
    ess: sp[last] - y[last],
    cross,
    crossTag: ok != null ? sim.loops[ok].tag : null,
    from,
    to,
  }
}

// ---------------------------------------------------------------- CSV
export function toCSV(sim) {
  const H = sim.hist
  const head = ['t_s', ...sim.P.tanks.map((t) => `h_${t.tag}_cm`)]
  sim.loops.forEach((L) => head.push(`SP_${L.tag}_cm`, `PV_${L.tag}_cm`, `OP_${sim.P.pumps[L.pump].tag}_pct`))
  const rows = [head.join(',')]
  for (let i = 0; i < H.t.length; i++) {
    const r = [H.t[i].toFixed(2), ...H.h.map((a) => a[i].toFixed(3))]
    sim.loops.forEach((_, j) => r.push(H.sp[j][i].toFixed(2), H.pv[j][i].toFixed(3), H.op[j][i].toFixed(2)))
    rows.push(r.join(','))
  }
  return rows.join('\n')
}
