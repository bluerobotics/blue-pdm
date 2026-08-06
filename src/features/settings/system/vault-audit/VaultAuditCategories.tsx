import { t } from '@/lib/i18n'
import type { VaultAuditCategory, VaultAuditCategoryKind } from '@/types/vaultAudit'

import { categoryDescription, categoryLabel, TONE_TEXT } from './vaultAuditLabels'

interface VaultAuditCategoriesProps {
  categories: VaultAuditCategory[]
  selected: VaultAuditCategoryKind | null
  onSelect: (kind: VaultAuditCategoryKind | null) => void
}

/**
 * The four categories, worst first.
 *
 * All four are always shown, including the empty ones, because "no values are lost" is the answer
 * an administrator came for and a card that disappears when it hits zero cannot give it.
 */
export function VaultAuditCategories({
  categories,
  selected,
  onSelect,
}: VaultAuditCategoriesProps) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-plm-fg">{t('vaultAudit.category.heading')}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {categories.map((category) => {
          const empty = category.valueCount === 0
          const isSelected = selected === category.kind

          return (
            <button
              key={category.kind}
              onClick={() => onSelect(isSelected ? null : category.kind)}
              disabled={empty}
              aria-pressed={isSelected}
              className={`text-left p-3 rounded-md border transition-colors ${
                isSelected
                  ? 'border-plm-accent bg-plm-highlight'
                  : 'border-plm-border hover:bg-plm-bg-lighter'
              } ${empty ? 'opacity-60 cursor-default hover:bg-transparent' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-plm-fg">{categoryLabel(category.kind)}</span>
                <span
                  className={`text-lg font-mono ${
                    empty ? 'text-plm-fg-muted' : TONE_TEXT[category.tone]
                  }`}
                >
                  {category.valueCount}
                </span>
              </div>
              <p className="text-xs text-plm-fg-muted mt-1">
                {categoryDescription(category.kind)}
              </p>
              {!empty && (
                <p className="text-xs text-plm-fg-muted/70 mt-1">
                  {t('vaultAudit.category.files', { count: category.fileCount })}
                </p>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
