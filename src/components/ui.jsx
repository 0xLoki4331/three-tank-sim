import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import { clamp } from '../sim/model.js'

export const TANK_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)']
const cssVar = (v) => (v.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() : v)

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d))
export const sig = (v, d = 3) => (v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(d - 1) : +v.toPrecision(d) + '')

/** Inline style giving a range input its fill position (WebKit has no native progress pseudo-element). */
export const rangePct = (v, min = 0, max = 100) => ({ '--pct': `${((v - min) / (max - min || 1)) * 100}%` })

/** Polynomial (descending coeffs) as text, e.g. "5210s² + 228s + 1.82". */
export function poly(c) {
  const n = c.length - 1
  const big = Math.max(...c.map(Math.abs))
  const terms = c
    .map((v, i) => [v, n - i])
    .filter(([v]) => Math.abs(v) > 1e-9 * big)
    .map(([v, p], i) => {
      const s = sig(Math.abs(v), 3)
      const sgn = v < 0 ? '− ' : i ? '+ ' : ''
      return `${sgn}${p === 0 ? s : `${s}${p === 1 ? 's' : `s${'²³⁴'[p - 2]}`}`}`
    })
  return terms.join(' ') || '0'
}

/** Number input that commits on Enter/blur, so 30 fps re-renders don't fight the cursor. */
export function NumInput({ value, onCommit, min = -Infinity, max = Infinity, step = 'any', digits = 2, className = 'num', ...rest }) {
  const [txt, setTxt] = useState(null)
  const [warn, setWarn] = useState(null) // HMI feedback: say so when a value was limited or rejected
  const flash = (msg) => (setWarn(msg), setTimeout(() => setWarn(null), 2500))
  const cancel = useRef(false)
  const commit = () => {
    const v = parseFloat(txt)
    if (cancel.current) cancel.current = false
    else if (txt != null && txt !== '') {
      if (!Number.isFinite(v)) flash('Not a number — value unchanged')
      else {
        const c = clamp(v, min, max)
        if (c !== v) flash(`Limited to ${c} (range ${min} – ${max})`)
        onCommit(c)
      }
    }
    setTxt(null)
  }
  return (
    <span className="numwrap">
    <input
      type="number"
      className={`${className}${warn ? ' clamped' : ''}`}
      title={warn ?? undefined}
      aria-invalid={warn ? true : undefined}
      step={step}
      value={txt ?? (Number.isFinite(value) ? +value.toFixed(digits) : '')}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') ((cancel.current = true), e.currentTarget.blur()) // abandon edit
      }}
      {...rest}
    />
    {warn && <span className="numwarn" role="status">{warn}</span>}
    </span>
  )
}

export function Seg({ value, options, onChange, small, label }) {
  return (
    <div className={`seg${small ? ' sm' : ''}`} role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  )
}

/**
 * uPlot wrapper. series: [{label, color, dash?, width?}]; data: [x[], ...y[]].
 * xRange [min,max] pins the window (live follow); omit to keep user zoom.
 */
export function Chart({ series, data, height = 200, yRange, yLabel, xRange, theme, xFmt = fmtTime }) {
  const el = useRef(null)
  const plot = useRef(null)
  const sKey = series.map((s) => s.label + s.color + s.dash).join('|')

  useEffect(() => {
    const grid = cssVar('var(--line)')
    const ink = cssVar('var(--muted)')
    const axis = { stroke: ink, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 }, font: '11px IBM Plex Mono, monospace', labelFont: '11px IBM Plex Sans, sans-serif' }
    const u = new uPlot(
      {
        width: el.current.clientWidth || 600,
        height,
        scales: { x: { time: false }, y: yRange ? { range: () => yRange } : { auto: true } },
        axes: [
          { ...axis, values: (_, v) => v.map(xFmt) },
          { ...axis, label: yLabel, size: 52 },
        ],
        cursor: { drag: { x: true, y: false } },
        // legend shows the latest sample whenever the cursor isn't over the plot
        hooks: { setCursor: [(u) => u.cursor.idx == null && u.data[0].length && u.setLegend({ idx: u.data[0].length - 1 })] },
        series: [
          { label: 't', value: (_, v) => (v == null ? '—' : xFmt(v)) },
          ...series.map((s) => ({ label: s.label, stroke: cssVar(s.color), width: s.width ?? 1.6, dash: s.dash, points: { show: false }, value: (_, v) => (v == null ? '—' : v.toFixed(2)) })),
        ],
      },
      data,
      el.current,
    )
    plot.current = u
    const ro = new ResizeObserver(() => u.setSize({ width: el.current.clientWidth, height }))
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      u.destroy()
      plot.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sKey, height, theme, yLabel, yRange?.[0], yRange?.[1]])

  useEffect(() => {
    const u = plot.current
    if (!u) return
    u.setData(data, !xRange)
    if (xRange) u.setScale('x', { min: xRange[0], max: xRange[1] })
    if (u.cursor.idx == null && data[0].length) u.setLegend({ idx: data[0].length - 1 })
  }, [data, xRange?.[0], xRange?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} style={{ overflow: 'hidden' }} />
}
