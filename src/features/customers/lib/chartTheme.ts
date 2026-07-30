/**
 * Resolved chart colors for the Customers analysis workspace.
 *
 * Recharts renders SVG and needs concrete color strings: it cannot compute
 * against `var(--plm-accent)` when it derives gradient stops or fades a series
 * out on legend hover. So rather than passing CSS variables through, this
 * resolves them once and re-resolves whenever the theme changes.
 */

import { useEffect, useState } from 'react'

export interface ChartTheme {
  fg: string
  fgDim: string
  fgMuted: string
  bg: string
  surface: string
  border: string
  borderLight: string
  accent: string
  success: string
  warning: string
  error: string
  info: string
  /** Categorical palette for multi-series charts. Accent always leads. */
  series: string[]
}

const TOKENS = {
  fg: '--plm-fg',
  fgDim: '--plm-fg-dim',
  fgMuted: '--plm-fg-muted',
  bg: '--plm-bg',
  surface: '--plm-bg-light',
  border: '--plm-border',
  borderLight: '--plm-border-light',
  accent: '--plm-accent',
  success: '--plm-success',
  warning: '--plm-warning',
  error: '--plm-error',
  info: '--plm-info',
} as const

/**
 * Hues that stay legible on both the near-black dark themes and the white
 * light theme. Deliberately fixed rather than theme-derived: a categorical
 * scale has to keep slices distinguishable from each other, which a ramp
 * generated from a single accent color does not.
 */
const CATEGORICAL = [
  '#4ec9b0',
  '#c586c0',
  '#f59e0b',
  '#75beff',
  '#f48fb1',
  '#81c784',
  '#ff8a65',
  '#ce93d8',
  '#4dd0e1',
  '#dcdcaa',
  '#a855f7',
  '#22c55e',
]

const FALLBACK: ChartTheme = {
  fg: '#cccccc',
  fgDim: '#b4b4b4',
  fgMuted: '#6e6e6e',
  bg: '#181818',
  surface: '#1f1f1f',
  border: '#2b2b2b',
  borderLight: '#3c3c3c',
  accent: '#0078d4',
  success: '#4ade80',
  warning: '#dcdcaa',
  error: '#f14c4c',
  info: '#3794ff',
  series: ['#0078d4', ...CATEGORICAL],
}

function readTheme(): ChartTheme {
  if (typeof window === 'undefined') return FALLBACK

  const computed = getComputedStyle(document.documentElement)
  const read = (token: string, fallback: string) =>
    computed.getPropertyValue(token).trim() || fallback

  const accent = read(TOKENS.accent, FALLBACK.accent)

  return {
    fg: read(TOKENS.fg, FALLBACK.fg),
    fgDim: read(TOKENS.fgDim, FALLBACK.fgDim),
    fgMuted: read(TOKENS.fgMuted, FALLBACK.fgMuted),
    bg: read(TOKENS.bg, FALLBACK.bg),
    surface: read(TOKENS.surface, FALLBACK.surface),
    border: read(TOKENS.border, FALLBACK.border),
    borderLight: read(TOKENS.borderLight, FALLBACK.borderLight),
    accent,
    success: read(TOKENS.success, FALLBACK.success),
    warning: read(TOKENS.warning, FALLBACK.warning),
    error: read(TOKENS.error, FALLBACK.error),
    info: read(TOKENS.info, FALLBACK.info),
    series: [accent, ...CATEGORICAL],
  }
}

/**
 * Chart colors for the active theme.
 *
 * Watches both `data-theme` (the four named themes) and the inline `style`
 * attribute, because the weather theme writes `--plm-*` overrides directly
 * onto the root element instead of switching `data-theme`.
 */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(readTheme)

  useEffect(() => {
    const sync = () => setTheme(readTheme())
    sync()

    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style'],
    })

    return () => observer.disconnect()
  }, [])

  return theme
}

/** Stable color for a category slice, so a category keeps its hue across charts. */
export function seriesColor(theme: ChartTheme, index: number): string {
  return theme.series[index % theme.series.length]
}

/**
 * Hex color with an alpha channel appended. Recharts fill props take plain
 * strings, so opacity has to be baked into the color for area gradients.
 */
export function withAlpha(color: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha))

  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const expanded =
      color.length === 4
        ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
        : color
    const hex = Math.round(clamped * 255)
      .toString(16)
      .padStart(2, '0')
    return `${expanded}${hex}`
  }

  // Non-hex tokens (the themes use rgba() for --plm-highlight) cannot be
  // extended with an alpha suffix, so they are returned untouched.
  return color
}
