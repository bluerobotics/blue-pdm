// Canvas and node dimension constants
export const DEFAULT_STATE_WIDTH = 120
export const DEFAULT_STATE_HEIGHT = 60
export const DEFAULT_CORNER_RADIUS = 8

// Canvas interaction
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2
export const ZOOM_STEP = 0.1
export const DRAG_THRESHOLD = 5 // Pixels of movement before drag starts

// Handle sizes
export const RESIZE_HANDLE_SIZE = 4

/** Stroke colour of a transition that has no colour of its own. */
export const DEFAULT_LINE_COLOR = '#6b7280'

// ============================================
// Shape outlines
// ============================================

/** Segments used to approximate an ellipse outline for hit-testing and snapping. */
export const ELLIPSE_OUTLINE_SEGMENTS = 64
/** Segments used per rounded-rectangle corner arc. */
export const ROUNDED_CORNER_SEGMENTS = 6

// ============================================
// Connection snapping
//
// These are screen pixels. Divide by the current zoom before comparing against
// canvas-space distances, so the magnets feel identical at every zoom level.
// ============================================

/** Distance at which the cursor is pulled onto one of a node's connection ports. */
export const PORT_SNAP_RADIUS_PX = 16
/** Band around the outline within which the endpoint pins to the exact border point. */
export const PERIMETER_SNAP_BAND_PX = 10
/** How far outside a node the cursor can be and still target it for a body attachment. */
export const TARGET_ATTRACT_RADIUS_PX = 28
/** Drawn radius of a connection port. */
export const PORT_VISUAL_RADIUS_PX = 4.5
/** Invisible grab radius of a connection port, so ports stay clickable when zoomed out. */
export const PORT_HIT_RADIUS_PX = 12
/** How far outside the silhouette the drop-target highlight is drawn. */
export const DROP_TARGET_INFLATE_PX = 3
/** Half-length of the highlighted border run drawn either side of a pinned snap point. */
export const EDGE_HIGHLIGHT_ARC_PX = 36
/** Drawn radius of a transition endpoint or waypoint handle. */
export const HANDLE_VISUAL_RADIUS_PX = 5
/** Invisible grab radius of those handles, so they survive being zoomed out. */
export const HANDLE_HIT_RADIUS_PX = 12
/** Ring drawn around a hovered waypoint. */
export const WAYPOINT_HOVER_RING_PX = 9

// Transition path generation
export const STRAIGHT_LENGTH = 20 // Length of straight perpendicular segments at box edges
export const ELBOW_TURN_OFFSET = 30 // Minimum distance to travel before turning for elbow paths
export const PARALLEL_EDGE_OFFSET = 14 // Perpendicular shift for opposite-direction transition pairs

// Distance from the path at which the transition label and gate badge are drawn
export const LABEL_ABOVE_PATH_OFFSET = 20
export const GATE_BELOW_PATH_OFFSET = 15

// Offset applied to a pasted node so it doesn't land exactly on its source
export const PASTE_OFFSET = 50

// Default snap settings
export const DEFAULT_SNAP_SETTINGS = {
  gridSize: 20,
  snapToGrid: false,
  snapToAlignment: true,
  alignmentThreshold: 8,
}

// History limits
export const MAX_HISTORY = 50

// Default preset colors for the color picker toolbar
export const DEFAULT_PRESET_COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#84cc16', // Lime
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#a855f7', // Purple
  '#d946ef', // Fuchsia
  '#ec4899', // Pink
  '#6b7280', // Gray
]

// Additional workflow colors (beyond the main palette)
export const WORKFLOW_ADDITIONAL_COLORS = [
  '#dc2626', // Red-600
  '#ea580c', // Orange-600
  '#d97706', // Amber-600
  '#65a30d', // Lime-600
  '#16a34a', // Green-600
  '#0d9488', // Teal-600
  '#0891b2', // Cyan-600
  '#2563eb', // Blue-600
  '#4f46e5', // Indigo-600
  '#7c3aed', // Violet-600
  '#9333ea', // Purple-600
  '#c026d3', // Fuchsia-600
  '#db2777', // Pink-600
  '#4b5563', // Gray-600
  '#374151', // Gray-700
  '#1f2937', // Gray-800
]
