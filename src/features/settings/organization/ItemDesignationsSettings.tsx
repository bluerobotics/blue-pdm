import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import {
  deleteItemDesignation,
  getItemDesignations,
  upsertItemDesignation,
} from '@/lib/supabase'
import type { ItemDesignation } from '@/types/item'

export function ItemDesignationsSettings() {
  const organization = usePDMStore((s) => s.organization)
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const hasPermission = usePDMStore((s) => s.hasPermission)
  const addToast = usePDMStore((s) => s.addToast)

  const canManage =
    getEffectiveRole() === 'admin' || hasPermission('system:item-designations', 'edit')

  const [designations, setDesignations] = useState<ItemDesignation[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')

  const load = useCallback(async () => {
    if (!organization?.id) return
    setLoading(true)
    try {
      setDesignations(await getItemDesignations(organization.id))
    } finally {
      setLoading(false)
    }
  }, [organization?.id])

  useEffect(() => {
    load()
  }, [load])

  const resetForm = () => {
    setEditingId(null)
    setNameInput('')
  }

  const handleSave = async () => {
    if (!organization?.id) return
    const name = nameInput.trim()
    if (!name) return
    setSaving(true)
    try {
      await upsertItemDesignation(organization.id, name, editingId)
      await load()
      resetForm()
    } catch (error) {
      log.error('[ItemDesignationsSettings]', 'Failed to save designation', { error })
      addToast('error', error instanceof Error ? error.message : 'Failed to save designation')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!organization?.id) return
    if (!window.confirm(t('itemBrowser.deleteDesignationConfirm'))) return
    try {
      await deleteItemDesignation(organization.id, id)
      await load()
      if (editingId === id) resetForm()
    } catch (error) {
      log.error('[ItemDesignationsSettings]', 'Failed to delete designation', { error })
      addToast('error', error instanceof Error ? error.message : 'Failed to delete designation')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          {t('itemBrowser.designationsTitle')}
        </h3>
        <p className="text-sm text-plm-fg-dim mt-1">{t('itemBrowser.designationsDescription')}</p>
      </div>

      {!canManage && (
        <p className="text-sm text-plm-warning">{t('itemBrowser.noPermission')}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-24 text-plm-fg-muted">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-0.5">
          {designations.length === 0 ? (
            <p className="text-sm text-plm-fg-dim px-3 py-2">{t('itemBrowser.noDesignations')}</p>
          ) : (
            designations.map((designation) => (
              <div
                key={designation.id}
                className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2 rounded hover:bg-plm-highlight/50 transition-colors items-center"
              >
                <span className="text-sm text-plm-fg">{designation.name}</span>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(designation.id)
                        setNameInput(designation.name)
                      }}
                      className="p-1.5 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light"
                      title={t('common.edit')}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(designation.id)}
                      className="p-1.5 rounded text-plm-fg-muted hover:text-plm-error hover:bg-plm-bg-light"
                      title={t('common.delete')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {canManage && (
        <div className="flex items-center gap-2 border-t border-plm-border pt-4">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
            }}
            placeholder={t('itemBrowser.designationName')}
            className="flex-1 max-w-xs bg-plm-bg border border-plm-border rounded px-3 py-1.5 text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:border-plm-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !nameInput.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-plm-accent text-white hover:bg-plm-accent/90 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {editingId ? t('common.save') : t('itemBrowser.addDesignation')}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="flex items-center gap-1 px-2 py-1.5 text-sm rounded-lg text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light transition-colors"
            >
              <X size={14} />
              {t('common.cancel')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
