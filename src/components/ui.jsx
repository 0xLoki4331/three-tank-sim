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

/** Number input that commits on Enter/blur, so 30 fps re-renders don't fight the cursor. */
export function NumInput({ value, onCommit, min = -Infinity, max = Infinity, step = 'any', digits = 2, className = 'num', ...rest }) {
  const [txt, setTxt] = useState(null)
  const commit = () => {
    const v = parseFloat(txt)
    if (txt != null && Number.isFinite(v)) onCommit(clamp(v, min, max))
    setTxt(null)
  }
  return (
    <input
      type="number"
      className={className}
      step={step}
      value={txt ?? (Number.isFinite(value) ? +value.toFixed(digits) : '')}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      {...rest}
    />
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
  }, [data, xRange?.[0], xRange?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} />
}
