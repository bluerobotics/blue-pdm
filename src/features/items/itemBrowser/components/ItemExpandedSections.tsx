import { FileText, ListTree, Package, ShieldCheck } from 'lucide-react'

import { t } from '@/lib/i18n'
import { FileTypeIcon } from '@/components/shared/FileItem'
import type { ItemRow } from '@/types/item'
import type { PDMFile } from '@/types/pdm'

interface ItemExpandedSectionsProps {
  row: ItemRow
  isAssembly: boolean
  onOpenEbom: (row: ItemRow) => void
  onOpenMbom: (row: ItemRow) => void
  onOpenFile?: (relativePath: string) => void
}

// A file is considered a "design output" (Release) when it is a neutral export
// format rather than a source CAD/document file.
function isDesignOutput(file: PDMFile): boolean {
  if (file.file_type === 'step' || file.file_type === 'pdf') return true
  const ext = (file.extension ?? '').toLowerCase()
  return ext === '.stl'
}

function FileRow({
  file,
  onOpenFile,
}: {
  file: PDMFile
  onOpenFile?: (relativePath: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => file.file_path && onOpenFile?.(file.file_path)}
      className="flex items-center gap-2 w-full px-2 py-1 rounded text-left text-plm-fg-muted hover:bg-plm-bg-light hover:text-plm-fg transition-colors"
      title={file.file_name}
    >
      <FileTypeIcon extension={file.extension ?? ''} size={14} />
      <span className="truncate flex-1 min-w-0">{file.file_name}</span>
      {file.revision && (
        <span className="text-[10px] text-plm-fg-muted tabular-nums shrink-0">
          {file.revision}
        </span>
      )}
    </button>
  )
}

function SectionHeader({
  icon,
  label,
}: {
  icon: React.ReactNode
  label: string
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-plm-fg-muted">
      {icon}
      <span>{label}</span>
    </div>
  )
}

function QualityReportRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-plm-bg">
      <span className="text-plm-fg-muted truncate">{label}</span>
      <span className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-plm-bg-light text-plm-fg-muted">
          {t('itemBrowser.noTemplateDefined')}
        </span>
        <button
          type="button"
          className="text-[10px] px-2 py-0.5 rounded border border-plm-border text-plm-fg-muted hover:text-plm-fg hover:border-plm-accent transition-colors"
          title={t('itemBrowser.comingSoon')}
        >
          {t('itemBrowser.selectTemplate')}
        </button>
      </span>
    </div>
  )
}

export function ItemExpandedSections({
  row,
  isAssembly,
  onOpenEbom,
  onOpenMbom,
  onOpenFile,
}: ItemExpandedSectionsProps) {
  const sourceFiles = row.files.filter((f) => !isDesignOutput(f))
  const releaseFiles = row.files.filter((f) => isDesignOutput(f))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-8 py-3 bg-plm-bg-light/40 text-sm">
      {/* Source */}
      <div className="space-y-1.5">
        <SectionHeader icon={<FileText size={12} />} label={t('itemBrowser.source')} />
        <div className="space-y-0.5">
          {sourceFiles.length > 0 ? (
            sourceFiles.map((file) => (
              <FileRow key={file.id} file={file} onOpenFile={onOpenFile} />
            ))
          ) : (
            <div className="px-2 py-1 text-plm-fg-muted/70 text-xs">
              {t('itemBrowser.noSourceFiles')}
            </div>
          )}
        </div>
      </div>

      {/* Release */}
      <div className="space-y-1.5">
        <SectionHeader icon={<Package size={12} />} label={t('itemBrowser.release')} />
        <div className="space-y-0.5">
          {releaseFiles.length > 0 ? (
            releaseFiles.map((file) => (
              <FileRow key={file.id} file={file} onOpenFile={onOpenFile} />
            ))
          ) : (
            <div className="px-2 py-1 text-plm-fg-muted/70 text-xs">
              {t('itemBrowser.noReleaseFiles')}
            </div>
          )}
        </div>
      </div>

      {/* BOMs (assemblies only) */}
      {isAssembly && (
        <div className="space-y-1.5">
          <SectionHeader icon={<ListTree size={12} />} label={t('itemBrowser.boms')} />
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => onOpenEbom(row)}
              className="flex items-center gap-2 w-full px-2 py-1 rounded text-left text-plm-fg-muted hover:bg-plm-bg-light hover:text-plm-fg transition-colors"
            >
              <ListTree size={14} className="text-plm-accent" />
              <span className="flex-1">{t('itemBrowser.ebom')}</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenMbom(row)}
              className="flex items-center gap-2 w-full px-2 py-1 rounded text-left text-plm-fg-muted hover:bg-plm-bg-light hover:text-plm-fg transition-colors"
            >
              <ListTree size={14} className="text-amber-400" />
              <span className="flex-1">{t('itemBrowser.mbom')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Quality */}
      <div className="space-y-1.5">
        <SectionHeader icon={<ShieldCheck size={12} />} label={t('itemBrowser.quality')} />
        <div className="space-y-1">
          <QualityReportRow label={t('itemBrowser.faiReports')} />
          <QualityReportRow label={t('itemBrowser.imrReports')} />
        </div>
      </div>
    </div>
  )
}
