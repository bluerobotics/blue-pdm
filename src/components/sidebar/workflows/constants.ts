// Canvas and node dimension constants
export const DEFAULT_STATE_WIDTH = 120
export const DEFAULT_STATE_HEIGHT = 60

// Canvas interaction
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2
export const ZOOM_STEP = 0.1
export const DRAG_THRESHOLD = 5 // Pixels of movement before drag starts

// Handle sizes
export const RESIZE_HANDLE_SIZE = 4
export const CONNECTION_HANDLE_SIZE = 4
export const CONNECTION_OFFSET = 12 // How far connection points float outside the box
export const WAYPOINT_HANDLE_SIZE = 6

// Transition path generation
export const STRAIGHT_LENGTH = 20 // Length of straight perpendicular segments at box edges
export const ELBOW_TURN_OFFSET = 30 // Minimum distance to travel before turning for elbow paths

// Default snap settings
export const DEFAULT_SNAP_SETTINGS = {
  gridSize: 40,
  snapToGrid: false,
  snapToAlignment: true,
  alignmentThreshold: 10
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
