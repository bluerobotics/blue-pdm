import { useEffect, useState } from 'react'
import { ListTree, X } from 'lucide-react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { getContains } from '@/lib/supabase'
import { BomTree } from '@/features/integrations/solidworks'
import type { BomNode } from '@/features/integrations/solidworks'
import type { ItemPanelState } from '@/stores/types'

interface ItemBomPanelProps {
  panel: ItemPanelState
  onClose: () => void
}

// Shape of the joined child rows returned by getContains
interface ContainsReference {
  quantity: number | null
  configuration: string | null
  child: {
    id: string
    file_name: string
    file_path: string
    part_number: string | null
    revision: string | null
    state: string | null
    description: string | null
  } | null
}

function deriveFileType(fileName: string): BomNode['fileType'] {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.sldasm')) return 'assembly'
  if (lower.endsWith('.slddrw')) return 'drawing'
  if (lower.endsWith('.sldprt')) return 'part'
  return 'other'
}

function ItemEbomContent({ fileId, title }: { fileId: string | null; title: string }) {
  const [nodes, setNodes] = useState<BomNode[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!fileId) {
      setNodes([])
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const { references, error } = await getContains(fileId)
        if (error) throw error
        const mapped: BomNode[] = ((references ?? []) as ContainsReference[])
          .filter((ref) => ref.child)
          .map((ref) => {
            const child = ref.child!
            return {
              fileId: child.id,
              filePath: child.file_path,
              fileName: child.file_name,
              fileType: deriveFileType(child.file_name),
              partNumber: child.part_number,
              description: child.description,
              revision: child.revision,
              state: child.state,
              quantity: ref.quantity ?? 1,
              configuration: ref.configuration,
              children: [],
              inDatabase: true,
            }
          })
        if (!cancelled) setNodes(mapped)
      } catch (error) {
        log.error('[ItemBomPanel]', 'Failed to load eBOM', { error })
        if (!cancelled) setNodes([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [fileId])

  if (!fileId) {
    return (
      <div className="text-sm text-plm-fg-muted text-center py-8">
        {t('itemBrowser.noSourceFiles')}
      </div>
    )
  }

  return <BomTree nodes={nodes} isLoading={loading} assemblyName={title} />
}

export function ItemBomPanel({ panel, onClose }: ItemBomPanelProps) {
  const label = panel.kind === 'ebom' ? t('itemBrowser.ebom') : t('itemBrowser.mbom')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-plm-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ListTree size={14} className="text-plm-accent shrink-0" />
          <span className="text-sm font-medium text-plm-fg truncate">
            {label} · {panel.title}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light"
          title={t('common.close')}
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {panel.kind === 'ebom' ? (
          <ItemEbomContent fileId={panel.fileId} title={panel.title} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-plm-fg-muted">
            <ListTree size={32} className="mb-3 opacity-30" />
            <div className="text-sm">{t('itemBrowser.comingSoon')}</div>
          </div>
        )}
      </div>
    </div>
  )
}
