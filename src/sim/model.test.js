// Run: npm test   — physics + controller + analysis sanity checks (no framework).
import assert from 'node:assert/strict'
import { Sim, G, PID } from './model.js'
import { linearize, stepTest, tuningRules, relayTest, roots, metrics } from './analysis.js'

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(4)}, want ${b.toFixed(4)} ±${tol}`)
const k = (p) => p.Cd * p.a * Math.sqrt(2 * G)
const hold = (s, ops) => s.loops.forEach((L, j) => ((L.mode = 'MAN'), (L.out = ops[j])))

// 1. Non-interacting series: every tank settles at h = (Q / (Cd·a·√2g))²
{
  const s = new Sim('series')
  hold(s, [40])
  s.run(6000)
  const want = (40e-6 / k(s.P.pipes[0])) ** 2
  s.h.forEach((h, i) => near(h, want, 1e-4, `series T${i + 1} steady state`))
}

// 2. Interacting series: T3 = (Q/k30)², each upstream tank adds (Q/k)²
{
  const s = new Sim('interacting')
  hold(s, [40])
  s.run(8000)
  const [p12, p23, p30] = s.P.pipes
  const h3 = (40e-6 / k(p30)) ** 2
  const h2 = h3 + (40e-6 / k(p23)) ** 2
  const h1 = h2 + (40e-6 / k(p12)) ** 2
  near(s.h[2], h3, 2e-4, 'interacting h3')
  near(s.h[1], h2, 2e-4, 'interacting h2')
  near(s.h[0], h1, 2e-4, 'interacting h1')
}

// 3. DTS200 mass balance: q20 = Q1 + Q2, q13 = Q1
{
  const s = new Sim('dts200')
  hold(s, [30, 25])
  s.run(8000)
  const [p13, , p20] = s.P.pipes
  near(s.h[1], (55e-6 / k(p20)) ** 2, 2e-4, 'DTS200 h2')
  near(s.h[0] - s.h[2], (30e-6 / k(p13)) ** 2, 2e-4, 'DTS200 h1−h3')
}

// 4. Closed loop reaches setpoint on every preset (default tuning)
for (const key of ['dts200', 'series', 'interacting']) {
  const s = new Sim(key)
  s.run(4000)
  s.loops.forEach((L) => near(s.h[L.tank] * 100, L.sp, 0.3, `${key} ${L.tag} tracks SP`))
  const m = metrics(s, 0)
  assert.ok(m && m.settling != null, `${key} metrics settle`)
  console.log(`  ${key.padEnd(12)} ${s.loops.map((L) => `${L.tag}=${(s.h[L.tank] * 100).toFixed(2)}cm`).join(' ')}  OS=${m.overshoot.toFixed(1)}% ts=${m.settling.toFixed(0)}s`)
}

// 5. Bumpless MAN→AUTO: output doesn't jump
{
  const pid = new PID({ Kc: 5, Ti: 50 })
  pid.update(30, 20, 0.1, 'MAN', 42)
  near(pid.update(30, 20, 0.1, 'AUTO', 42), 42, 0.2, 'bumpless transfer')
}

// 6. Linearisation: steady-state gain −C A⁻¹ B matches a small nonlinear step
{
  const s = new Sim('series')
  hold(s, [40])
  const lin = linearize(s)
  const tf = lin.tf.find((g) => g.out === 2 && g.inp === 0)
  const want = (2 * lin.h0[2]) / 40 // h ∝ Q²  →  dh/dQ = 2h/Q  [cm/%]
  near(tf.K, want, 0.01, 'series linear gain dh3/dOP')
  lin.tau.forEach((t) => near(t, lin.tau[0], 1, 'series: three equal time constants'))
  near(lin.tau[0], (2 * 0.0154 * lin.h0[0] / 100) / 40e-6, 2, 'series τ = 2Ah/Q')
  console.log(`  linear      K=${tf.K.toFixed(3)} cm/%  τ=${lin.tau.map((t) => t.toFixed(1)).join(', ')} s`)
}

// 7. Roots + identification + tuning are finite
{
  const r = roots([1, -6, 11, -6]).map((z) => z[0]).sort()
  ;[1, 2, 3].forEach((v, i) => near(r[i], v, 1e-6, 'cubic roots'))
  const s = new Sim('series')
  s.run(3000)
  const st = stepTest(s, 0, 10)
  assert.ok(st.fit && st.fit.tau > 0 && st.fit.K > 0, 'FOPDT fit')
  tuningRules(st.fit).forEach((r) => assert.ok(Number.isFinite(r.Kc) && r.Kc > 0, `${r.rule} ${r.kind}`))
  const rl = relayTest(s, 0, 10)
  assert.ok(rl.ok && rl.Ku > 0 && rl.Pu > 0 && !rl.hyst, 'relay test oscillates (3rd-order loop)')
  const d = new Sim('dts200')
  d.run(3000)
  assert.ok(relayTest(d, 0, 10).hyst, 'DTS200 h1 loop is relative-degree 1 → relay flagged as hysteresis-dominated')
  console.log(`  FOPDT       K=${st.fit.K.toFixed(3)} τ=${st.fit.tau.toFixed(0)}s θ=${st.fit.theta.toFixed(0)}s   relay Ku=${rl.Ku.toFixed(2)} Pu=${rl.Pu.toFixed(0)}s`)
}

console.log('all checks passed')
