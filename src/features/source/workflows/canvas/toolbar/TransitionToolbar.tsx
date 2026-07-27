/**
 * TransitionToolbar - Toolbar controls for workflow transitions
 */
import { useState } from 'react'
import { Edit3, Trash2 } from 'lucide-react'
import { ColorPicker } from '@/components/shared/ColorPicker'
import { t } from '@/lib/i18n'
import { TickSlider } from '../TickSlider'
import type {
  WorkflowTransition,
  TransitionLineStyle,
  TransitionPathType,
  TransitionArrowHead,
  TransitionLineThickness,
} from '@/types/workflow'

// Additional preset colors for workflow toolbar
const WORKFLOW_ADDITIONAL_COLORS = [
  '#10b981', // emerald
  '#0ea5e9', // sky
  '#d946ef', // fuchsia
  '#f5f5f4', // white
  '#a8a29e', // stone
  '#1f2937', // slate-dark
]

interface TransitionToolbarProps {
  targetTransition: WorkflowTransition
  isAdmin: boolean
  onColorChange: (color: string) => void
  onLineStyleChange?: (style: TransitionLineStyle) => void
  onPathTypeChange?: (pathType: TransitionPathType) => void
  onArrowHeadChange?: (arrowHead: TransitionArrowHead) => void
  onThicknessChange?: (thickness: TransitionLineThickness) => void
  onEdit: () => void
  onDelete: () => void
  closeAllDropdowns: () => void
}

export function TransitionToolbar({
  targetTransition,
  isAdmin,
  onColorChange,
  onLineStyleChange,
  onPathTypeChange,
  onArrowHeadChange,
  onThicknessChange,
  onEdit,
  onDelete,
  closeAllDropdowns,
}: TransitionToolbarProps) {
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showPathTypes, setShowPathTypes] = useState(false)
  const [showArrowHeads, setShowArrowHeads] = useState(false)
  const [showThickness, setShowThickness] = useState(false)

  const currentColor = targetTransition.line_color || '#6b7280'
  const currentLineStyle = targetTransition.line_style || 'solid'
  const currentPathType = targetTransition.line_path_type || 'spline'
  const currentArrowHead = targetTransition.line_arrow_head || 'end'
  const currentThickness = targetTransition.line_thickness || 2

  const pathTypeLabels: Record<TransitionPathType, string> = {
    straight: t('workflows.transitionToolbar.pathStraight'),
    spline: t('workflows.transitionToolbar.pathSpline'),
    elbow: t('workflows.transitionToolbar.pathElbow'),
  }

  const styleLabels: Record<TransitionLineStyle, string> = {
    solid: t('workflows.transitionToolbar.styleSolid'),
    dashed: t('workflows.transitionToolbar.styleDashed'),
    dotted: t('workflows.transitionToolbar.styleDotted'),
  }

  const handleCloseDropdowns = () => {
    setShowColorPicker(false)
    setShowPathTypes(false)
    setShowArrowHeads(false)
    setShowThickness(false)
    closeAllDropdowns()
  }

  return (
    <>
      {/* Color button */}
      <div className="relative">
        <button
          onClick={() => {
            handleCloseDropdowns()
            setShowColorPicker(!showColorPicker)
          }}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-highlight transition-colors"
          title={t('workflows.transitionToolbar.lineColor')}
        >
          <div
            className="w-5 h-5 rounded border-2 border-plm-fg/30"
            style={{ backgroundColor: currentColor }}
          />
        </button>

        {showColorPicker && (
          <ColorPicker
            color={currentColor}
            onChange={(color) => {
              if (color) onColorChange(color)
            }}
            onClose={handleCloseDropdowns}
            showReset={false}
            title={t('workflows.transitionToolbar.lineColor')}
            additionalPresets={WORKFLOW_ADDITIONAL_COLORS}
            position="left"
          />
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-plm-border mx-0.5" />

      {/* Path type (straight/spline/elbow) */}
      {onPathTypeChange && (
        <div className="relative">
          <button
            onClick={() => {
              handleCloseDropdowns()
              setShowPathTypes(!showPathTypes)
            }}
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-highlight transition-colors"
            title={t('workflows.transitionToolbar.linePathType')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" className="text-plm-fg-muted">
              {currentPathType === 'straight' && (
                <line x1="2" y1="14" x2="16" y2="4" stroke="currentColor" strokeWidth="2" />
              )}
              {currentPathType === 'spline' && (
                <path d="M2 14 Q9 2 16 8" fill="none" stroke="currentColor" strokeWidth="2" />
              )}
              {currentPathType === 'elbow' && (
                <path
                  d="M2 14 L2 9 L16 9 L16 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              )}
            </svg>
          </button>

          {showPathTypes && (
            <div className="absolute top-full left-0 mt-1 p-1 bg-plm-sidebar rounded-lg shadow-xl border border-plm-border flex flex-col gap-0.5 min-w-[130px]">
              {(['straight', 'spline', 'elbow'] as TransitionPathType[]).map((pathType) => (
                <button
                  key={pathType}
                  onClick={() => {
                    onPathTypeChange(pathType)
                    handleCloseDropdowns()
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm hover:bg-plm-highlight transition-colors ${
                    currentPathType === pathType
                      ? 'bg-plm-highlight text-plm-fg'
                      : 'text-plm-fg-muted'
                  }`}
                >
                  <svg width="24" height="16" viewBox="0 0 24 16">
                    {pathType === 'straight' && (
                      <line x1="2" y1="12" x2="22" y2="4" stroke="currentColor" strokeWidth="2" />
                    )}
                    {pathType === 'spline' && (
                      <path
                        d="M2 12 Q12 0 22 8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    )}
                    {pathType === 'elbow' && (
                      <path
                        d="M2 12 L2 8 L22 8 L22 4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    )}
                  </svg>
                  <span>{pathTypeLabels[pathType]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Line settings (thickness + style) */}
      {onThicknessChange && (
        <div className="relative">
          <button
            onClick={() => {
              handleCloseDropdowns()
              setShowThickness(!showThickness)
            }}
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-highlight transition-colors"
            title={t('workflows.transitionToolbar.lineSettings')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" className="text-plm-fg-muted">
              <line
                x1="2"
                y1="9"
                x2="16"
                y2="9"
                stroke="currentColor"
                strokeWidth={currentThickness}
                strokeDasharray={
                  currentLineStyle === 'dashed'
                    ? '4,2'
                    : currentLineStyle === 'dotted'
                      ? '1,3'
                      : 'none'
                }
                strokeLinecap={currentLineStyle === 'dotted' ? 'round' : 'butt'}
              />
            </svg>
          </button>

          {showThickness && (
            <div
              className="absolute top-full left-0 mt-1 p-3 bg-plm-sidebar rounded-lg shadow-xl border border-plm-border min-w-[180px]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Thickness slider */}
              <div className="mb-4">
                <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2 flex items-center justify-between">
                  <span>{t('workflows.transitionToolbar.thickness')}</span>
                  <span className="text-plm-fg-muted">{currentThickness}px</span>
                </div>
                <TickSlider
                  value={currentThickness}
                  min={1}
                  max={6}
                  step={1}
                  snapPoints={[1, 2, 3, 4, 5, 6]}
                  onChange={(val) => onThicknessChange(val as TransitionLineThickness)}
                />
              </div>

              {/* Line style */}
              {onLineStyleChange && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2">
                    {t('workflows.transitionToolbar.style')}
                  </div>
                  <div className="flex gap-1">
                    {(['solid', 'dashed', 'dotted'] as TransitionLineStyle[]).map((style) => (
                      <button
                        key={style}
                        onClick={() => onLineStyleChange(style)}
                        className={`flex-1 py-2 rounded flex items-center justify-center transition-colors ${
                          currentLineStyle === style
                            ? 'bg-plm-highlight'
                            : 'bg-plm-bg hover:bg-plm-highlight'
                        }`}
                        title={styleLabels[style]}
                      >
                        <svg width="32" height="8" viewBox="0 0 32 8" className="text-plm-fg">
                          <line
                            x1="2"
                            y1="4"
                            x2="30"
                            y2="4"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeDasharray={
                              style === 'dashed' ? '6,3' : style === 'dotted' ? '2,4' : 'none'
                            }
                            strokeLinecap={style === 'dotted' ? 'round' : 'butt'}
                          />
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Arrow direction */}
      {onArrowHeadChange && (
        <div className="relative">
          <button
            onClick={() => {
              handleCloseDropdowns()
              setShowArrowHeads(!showArrowHeads)
            }}
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-highlight transition-colors"
            title={t('workflows.transitionToolbar.arrowDirection')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" className="text-plm-fg-muted">
              <defs>
                <marker
                  id="toolbar-arrow"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 6 3, 0 6" fill="currentColor" />
                </marker>
              </defs>
              {currentArrowHead === 'end' && (
                <line
                  x1="2"
                  y1="9"
                  x2="14"
                  y2="9"
                  stroke="currentColor"
                  strokeWidth="2"
                  markerEnd="url(#toolbar-arrow)"
                />
              )}
              {currentArrowHead === 'start' && (
                <line
                  x1="16"
                  y1="9"
                  x2="4"
                  y2="9"
                  stroke="currentColor"
                  strokeWidth="2"
                  markerEnd="url(#toolbar-arrow)"
                />
              )}
              {currentArrowHead === 'none' && (
                <line x1="2" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth="2" />
              )}
            </svg>
          </button>

          {showArrowHeads && (
            <div
              className="absolute top-full right-0 mt-1 p-2 bg-plm-sidebar rounded-lg shadow-xl border border-plm-border"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2">
                {t('workflows.transitionToolbar.arrow')}
              </div>
              <div className="flex gap-1">
                {[
                  { value: 'end' as TransitionArrowHead, tooltip: t('workflows.transitionToolbar.arrowAtEnd') },
                  { value: 'start' as TransitionArrowHead, tooltip: t('workflows.transitionToolbar.arrowAtStart') },
                  { value: 'none' as TransitionArrowHead, tooltip: t('workflows.transitionToolbar.noArrows') },
                ].map(({ value, tooltip }) => (
                  <button
                    key={value}
                    onClick={() => onArrowHeadChange(value)}
                    className={`w-10 h-8 rounded flex items-center justify-center transition-colors ${
                      currentArrowHead === value
                        ? 'bg-plm-highlight'
                        : 'bg-plm-bg hover:bg-plm-highlight'
                    }`}
                    title={tooltip}
                  >
                    <svg width="28" height="12" viewBox="0 0 28 12" className="text-plm-fg">
                      {value === 'end' && (
                        <>
                          <line
                            x1="2"
                            y1="6"
                            x2="20"
                            y2="6"
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                          <polygon points="26,6 20,2 20,10" fill="currentColor" />
                        </>
                      )}
                      {value === 'start' && (
                        <>
                          <line
                            x1="8"
                            y1="6"
                            x2="26"
                            y2="6"
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                          <polygon points="2,6 8,2 8,10" fill="currentColor" />
                        </>
                      )}
                      {value === 'none' && (
                        <line x1="2" y1="6" x2="26" y2="6" stroke="currentColor" strokeWidth="2" />
                      )}
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Divider */}
      <div className="w-px h-5 bg-plm-border mx-0.5" />

      {/* Edit button */}
      <button
        onClick={onEdit}
        className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-highlight transition-colors text-plm-fg-muted hover:text-plm-fg"
        title={t('workflows.transitionToolbar.editTransition')}
      >
        <Edit3 size={16} />
      </button>

      {/* Divider */}
      <div className="w-px h-5 bg-plm-border mx-0.5" />

      {/* Delete */}
      {isAdmin && (
        <button
          onClick={onDelete}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-error/20 transition-colors text-plm-fg-muted hover:text-plm-error"
          title={t('workflows.transitionToolbar.deleteTransition')}
        >
          <Trash2 size={16} />
        </button>
      )}
    </>
  )
}
