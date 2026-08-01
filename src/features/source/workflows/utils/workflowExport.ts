/**
 * Workflow export payload: build, validate and parse.
 *
 * The exported file is the complete diagram - styling, node size, gates and
 * routing included - so a round trip through export/import reproduces what the
 * user was looking at. Version 1 files carried only a handful of fields and are
 * still accepted; anything they omit falls back to the database defaults.
 *
 * States are referenced by an opaque `key` (their id at export time) rather
 * than by name, because names are not unique within a workflow.
 */
import type { Json } from '@/types/database'
import type {
  WorkflowTemplate,
  WorkflowState,
  WorkflowTransition,
  WorkflowGate,
} from '@/types/workflow'

export const EXPORT_VERSION = '2.0'

export interface ExportedGate {
  name: string
  description: string | null
  gate_type: string
  required_approvals: number
  approval_mode: string
  checklist_items: Json
  conditions: Json
  is_blocking: boolean
  can_be_skipped_by: string[]
  sort_order: number
}

export interface ExportedState {
  key: string
  name: string
  label: string | null
  description: string | null
  state_type: string
  shape: string
  color: string | null
  fill_opacity: number | null
  border_color: string | null
  border_opacity: number | null
  border_thickness: number | null
  corner_radius: number | null
  icon: string | null
  position_x: number
  position_y: number
  width: number
  height: number
  is_editable: boolean
  requires_checkout: boolean
  auto_increment_revision: boolean
  triggers_review: boolean
  sort_order: number
}

export interface ExportedTransition {
  from: string
  to: string
  name: string | null
  description: string | null
  line_style: string
  line_color: string | null
  line_path_type: string
  line_arrow_head: string
  line_thickness: number | null
  auto_conditions: Json
  start_edge: string | null
  start_fraction: number | null
  end_edge: string | null
  end_fraction: number | null
  waypoints: Json
  label_offset: Json
  label_pinned: Json
  gates: ExportedGate[]
}

export interface WorkflowExport {
  version: string
  exportedAt: string
  workflow: {
    name: string
    description: string | null
    canvas_config: Json
  }
  states: ExportedState[]
  transitions: ExportedTransition[]
}

export function buildExportPayload(
  workflow: WorkflowTemplate,
  states: WorkflowState[],
  transitions: WorkflowTransition[],
  gates: Record<string, WorkflowGate[]>,
): WorkflowExport {
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    workflow: {
      name: workflow.name,
      description: workflow.description,
      canvas_config: jsonValue(workflow.canvas_config),
    },
    states: states.map((s) => ({
      key: s.id,
      name: s.name,
      label: s.label,
      description: s.description,
      state_type: s.state_type,
      shape: s.shape,
      color: s.color,
      fill_opacity: s.fill_opacity,
      border_color: s.border_color,
      border_opacity: s.border_opacity,
      border_thickness: s.border_thickness,
      corner_radius: s.corner_radius,
      icon: s.icon,
      position_x: s.position_x,
      position_y: s.position_y,
      width: s.width,
      height: s.height,
      is_editable: s.is_editable,
      requires_checkout: s.requires_checkout,
      auto_increment_revision: s.auto_increment_revision,
      triggers_review: s.triggers_review,
      sort_order: s.sort_order,
    })),
    transitions: transitions.map((t) => ({
      from: t.from_state_id,
      to: t.to_state_id,
      name: t.name,
      description: t.description,
      line_style: t.line_style,
      line_color: t.line_color,
      line_path_type: t.line_path_type,
      line_arrow_head: t.line_arrow_head,
      line_thickness: t.line_thickness,
      auto_conditions: t.auto_conditions,
      start_edge: t.start_edge,
      start_fraction: t.start_fraction,
      end_edge: t.end_edge,
      end_fraction: t.end_fraction,
      waypoints: t.waypoints,
      label_offset: t.label_offset,
      label_pinned: t.label_pinned,
      gates: (gates[t.id] ?? []).map((g) => ({
        name: g.name,
        description: g.description,
        gate_type: g.gate_type,
        required_approvals: g.required_approvals,
        approval_mode: g.approval_mode,
        checklist_items: g.checklist_items,
        conditions: g.conditions,
        is_blocking: g.is_blocking,
        can_be_skipped_by: g.can_be_skipped_by ?? [],
        sort_order: g.sort_order ?? 0,
      })),
    })),
  }
}

export type ParseResult =
  | { ok: true; payload: WorkflowExport }
  | { ok: false; reason: 'not-an-object' | 'no-states' | 'bad-state' | 'bad-transition' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Round-trips a value through JSON. The payload crosses into Postgres as jsonb,
 * so anything that survives this is safe to send and anything that doesn't had
 * no business being in the file.
 */
function jsonValue(value: unknown): Json {
  if (value === undefined || value === null) return null
  return JSON.parse(JSON.stringify(value)) as Json
}

/** The whole payload as jsonb, ready for the import RPC. */
export function exportPayloadAsJson(payload: WorkflowExport): Json {
  return jsonValue(payload)
}

/**
 * Validates a parsed JSON file well enough that the import RPC can trust it:
 * every state has a name and a unique key, and every transition points at a
 * state the payload actually defines.
 */
export function parseWorkflowExport(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, reason: 'not-an-object' }
  if (!Array.isArray(value.states) || value.states.length === 0) {
    return { ok: false, reason: 'no-states' }
  }

  const keys = new Set<string>()

  for (const state of value.states) {
    if (!isRecord(state)) return { ok: false, reason: 'bad-state' }
    if (typeof state.name !== 'string' || state.name.length === 0) {
      return { ok: false, reason: 'bad-state' }
    }
    // Version 1 files keyed states by name; version 2 by their exported id.
    const key = typeof state.key === 'string' ? state.key : state.name
    if (keys.has(key)) return { ok: false, reason: 'bad-state' }
    keys.add(key)
  }

  const rawTransitions = Array.isArray(value.transitions) ? value.transitions : []

  for (const transition of rawTransitions) {
    if (!isRecord(transition)) return { ok: false, reason: 'bad-transition' }
    const from = transition.from ?? transition.from_state
    const to = transition.to ?? transition.to_state
    if (typeof from !== 'string' || typeof to !== 'string') {
      return { ok: false, reason: 'bad-transition' }
    }
    if (!keys.has(from) || !keys.has(to)) return { ok: false, reason: 'bad-transition' }
  }

  return { ok: true, payload: normalise(value, rawTransitions) }
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/**
 * Rewrites a validated payload of any version into the current shape, dropping
 * anything of the wrong type rather than passing it to the database. Defaults
 * here mirror the column defaults in `workflow_states` and `workflow_transitions`.
 */
function normalise(value: Record<string, unknown>, rawTransitions: unknown[]): WorkflowExport {
  const workflow = isRecord(value.workflow) ? value.workflow : {}
  const states = value.states as unknown[]

  return {
    version: str(value.version, '1.0'),
    exportedAt: str(value.exportedAt, ''),
    workflow: {
      name: str(workflow.name, ''),
      description: nullableStr(workflow.description),
      canvas_config: jsonValue(workflow.canvas_config),
    },
    states: states.filter(isRecord).map(normaliseState),
    transitions: rawTransitions.filter(isRecord).map(normaliseTransition),
  }
}

function normaliseState(state: Record<string, unknown>): ExportedState {
  const name = str(state.name, '')

  return {
    key: str(state.key, name),
    name,
    label: nullableStr(state.label),
    description: nullableStr(state.description),
    state_type: str(state.state_type, 'state'),
    shape: str(state.shape, 'rectangle'),
    color: str(state.color, '#6B7280'),
    fill_opacity: num(state.fill_opacity, 1),
    border_color: nullableStr(state.border_color),
    border_opacity: num(state.border_opacity, 1),
    border_thickness: num(state.border_thickness, 2),
    corner_radius: num(state.corner_radius, 8),
    icon: str(state.icon, 'circle'),
    position_x: num(state.position_x, 0),
    position_y: num(state.position_y, 0),
    width: num(state.width, 120),
    height: num(state.height, 60),
    is_editable: bool(state.is_editable, true),
    requires_checkout: bool(state.requires_checkout, true),
    auto_increment_revision: bool(state.auto_increment_revision, false),
    triggers_review: bool(state.triggers_review, false),
    sort_order: num(state.sort_order, 0),
  }
}

function normaliseTransition(transition: Record<string, unknown>): ExportedTransition {
  return {
    from: str(transition.from ?? transition.from_state, ''),
    to: str(transition.to ?? transition.to_state, ''),
    name: nullableStr(transition.name),
    description: nullableStr(transition.description),
    line_style: str(transition.line_style, 'solid'),
    line_color: nullableStr(transition.line_color),
    line_path_type: str(transition.line_path_type, 'spline'),
    line_arrow_head: str(transition.line_arrow_head, 'end'),
    line_thickness: num(transition.line_thickness, 2),
    auto_conditions: jsonValue(transition.auto_conditions),
    start_edge: nullableStr(transition.start_edge),
    start_fraction: nullableNum(transition.start_fraction),
    end_edge: nullableStr(transition.end_edge),
    end_fraction: nullableNum(transition.end_fraction),
    waypoints: Array.isArray(transition.waypoints) ? jsonValue(transition.waypoints) : [],
    label_offset: isRecord(transition.label_offset) ? jsonValue(transition.label_offset) : null,
    label_pinned: isRecord(transition.label_pinned) ? jsonValue(transition.label_pinned) : null,
    gates: (Array.isArray(transition.gates) ? transition.gates : [])
      .filter(isRecord)
      .map(normaliseGate),
  }
}

function normaliseGate(gate: Record<string, unknown>): ExportedGate {
  return {
    name: str(gate.name, 'Gate'),
    description: nullableStr(gate.description),
    gate_type: str(gate.gate_type, 'approval'),
    required_approvals: num(gate.required_approvals, 1),
    approval_mode: str(gate.approval_mode, 'any'),
    checklist_items: Array.isArray(gate.checklist_items) ? jsonValue(gate.checklist_items) : [],
    conditions: jsonValue(gate.conditions),
    is_blocking: bool(gate.is_blocking, true),
    can_be_skipped_by: stringArray(gate.can_be_skipped_by),
    sort_order: num(gate.sort_order, 0),
  }
}
