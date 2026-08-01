// Utils barrel export
// Export from split utility files
export { lightenColor } from './colors'
export {
  getNearestPointOnBoxEdge,
  getPointFromEdgePosition,
  getClosestPointOnBox,
  getPerpendicularDirection,
} from './geometry'
export {
  buildOutline,
  resolveOutlineDimensions,
  outlineToPath,
  outlineToLocalPath,
  outlineRunPath,
  pointAtArcLength,
  inflateOutline,
  containsPoint,
  nearestPointOnOutline,
  intersectRayFromCenter,
  boundingBoxPointFromAnchor,
  anchorFromOutlinePoint,
  outlinePointFromAnchor,
  outlinePointToward,
  outlinePorts,
} from './shapeOutline'
export type { Outline, OutlineHit, OutlineState } from './shapeOutline'
export { resolveConnectionSnap, buildSnapCandidates } from './connectionSnap'
export type {
  ConnectionSnap,
  ConnectionSnapParams,
  SnapCandidate,
  SnapKind,
} from './connectionSnap'
export { getBezierMidpoint, getControlPointFromMidpoint, findInsertionIndex } from './pathHelpers'
export { generateSplinePath, getPointOnSpline, generateElbowPath } from './pathGeneration'
export {
  computeTransitionGeometry,
  computeParallelOffsets,
  resolveEffectiveWaypoints,
  resolveDimensions,
} from './transitionGeometry'
export type { TransitionGeometry, TransitionGeometryInput, GeometryState } from './transitionGeometry'
export { buildExportPayload, parseWorkflowExport, EXPORT_VERSION } from './workflowExport'
export type {
  WorkflowExport,
  ExportedState,
  ExportedTransition,
  ExportedGate,
  ParseResult,
} from './workflowExport'
export { useStableCallback } from './useStableCallback'
export { useRafThrottle } from './useRafThrottle'
