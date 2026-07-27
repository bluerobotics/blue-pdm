import { useState } from 'react'
import * as LucideIcons from 'lucide-react'
import { X } from 'lucide-react'

import { IconGridPicker } from '@/components/shared/IconPicker'

const PRESET_COLORS = [
  '', // theme default (no color)
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f87171',
  '#c084fc',
  '#f472b6',
  '#38bdf8',
]

export interface ItemIconModalProps {
  itemNumber: string
  initialIcon?: string | null
  initialColor?: string | null
  onSave: (iconName: string, iconColor: string | null) => Promise<void> | void
  onClose: () => void
  isSaving?: boolean
}

export function ItemIconModal({
  itemNumber,
  initialIcon,
  initialColor,
  onSave,
  onClose,
  isSaving = false,
}: ItemIconModalProps) {
  const [icon, setIcon] = useState<string>(initialIcon || 'Box')
  const [color, setColor] = useState<string>(initialColor || '')

  // Dynamic Lucide lookup requires an any cast (icon name is a runtime string)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Preview = (LucideIcons as any)[icon] || LucideIcons.Box // TODO: type this

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-md mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-plm-border">
          <div>
            <h3 className="text-lg font-medium text-plm-fg">Choose Icon</h3>
            <p className="text-xs text-plm-fg-muted mt-0.5 truncate">{itemNumber}</p>
          </div>
          <button
            onClick={onClose}
            className="text-plm-fg-muted hover:text-plm-fg transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-plm-bg flex items-center justify-center shrink-0">
              <Preview size={28} style={{ color: color || undefined }} />
            </div>
            <span className="text-sm text-plm-fg-muted">Preview</span>
          </div>

          <div>
            <span className="block text-sm font-medium text-plm-fg mb-2">Icon</span>
            <IconGridPicker value={icon} onChange={setIcon} />
          </div>

          <div>
            <span className="block text-sm font-medium text-plm-fg mb-2">Color</span>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map((preset) => (
                <button
                  key={preset || 'default'}
                  type="button"
                  onClick={() => setColor(preset)}
                  className={`w-6 h-6 rounded-full border-2 ${
                    color === preset ? 'border-plm-accent' : 'border-plm-border'
                  }`}
                  style={{ backgroundColor: preset || 'var(--plm-fg-muted)' }}
                  title={preset || 'Default'}
                />
              ))}
              <input
                type="color"
                value={color || '#888888'}
                onChange={(e) => setColor(e.target.value)}
                className="w-6 h-6 rounded cursor-pointer bg-transparent border border-plm-border"
                title="Custom color"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end px-6 py-4 border-t border-plm-border">
          <button onClick={onClose} className="btn btn-ghost" disabled={isSaving}>
            Cancel
          </button>
          <button
            onClick={() => onSave(icon, color || null)}
            className="btn btn-primary"
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
