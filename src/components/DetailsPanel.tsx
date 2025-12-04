import { useState, useEffect } from 'react'
import { usePDMStore } from '../stores/pdmStore'
import { formatFileSize, STATE_INFO, getFileIconType } from '../types/pdm'
import { format, formatDistanceToNow } from 'date-fns'
import { getFileVersions } from '../lib/supabase'
import { rollbackToVersion } from '../lib/fileService'
import { 
  FileBox, 
  Layers, 
  FileText, 
  File,
  Clock,
  User,
  Tag,
  Hash,
  Info,
  Cloud,
  RotateCcw,
  Check,
  Loader2,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  Cpu,
  FileType,
  FilePen
} from 'lucide-react'

interface VersionEntry {
  id: string
  version: number
  revision: string
  state: string
  comment: string | null
  content_hash: string
  file_size: number
  created_at: string
  created_by_user?: { email: string; full_name: string } | null
}

export function DetailsPanel() {
  const { 
    selectedFiles, 
    getSelectedFileObjects, 
    detailsPanelHeight,
    detailsPanelTab,
    setDetailsPanelTab,
    user,
    addToast
  } = usePDMStore()

  const selectedFileObjects = getSelectedFileObjects()
  const file = selectedFileObjects.length === 1 ? selectedFileObjects[0] : null
  
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [rollingBack, setRollingBack] = useState<number | null>(null)

  // Load version history when file changes or history tab is selected
  useEffect(() => {
    const loadVersions = async () => {
      if (!file?.pdmData?.id || detailsPanelTab !== 'history') {
        setVersions([])
        return
      }
      
      setIsLoadingVersions(true)
      try {
        const { versions: fileVersions, error } = await getFileVersions(file.pdmData.id)
        if (!error && fileVersions) {
          setVersions(fileVersions as VersionEntry[])
        }
      } catch (err) {
        console.error('Failed to load versions:', err)
      } finally {
        setIsLoadingVersions(false)
      }
    }
    
    loadVersions()
  }, [file?.pdmData?.id, detailsPanelTab])

  const handleRollback = async (targetVersion: number) => {
    if (!file?.pdmData?.id || !user) return
    
    // Check if file is checked out by current user
    if (file.pdmData.checked_out_by !== user.id) {
      addToast('error', 'You must check out the file before rolling back')
      return
    }
    
    setRollingBack(targetVersion)
    
    try {
      const result = await rollbackToVersion(
        file.pdmData.id,
        user.id,
        targetVersion,
        `Rolled back to version ${targetVersion}`
      )
      
      if (result.success) {
        addToast('success', `Rolled back to version ${targetVersion}`)
        // Reload versions
        const { versions: fileVersions } = await getFileVersions(file.pdmData.id)
        if (fileVersions) {
          setVersions(fileVersions as VersionEntry[])
        }
      } else {
        addToast('error', result.error || 'Failed to rollback')
      }
    } catch (err) {
      addToast('error', `Rollback failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRollingBack(null)
    }
  }

  const getFileIcon = () => {
    if (!file) return <File size={32} className="text-pdm-fg-muted" />
    
    if (file.isDirectory) {
      return <File size={32} className="text-pdm-warning" />
    }
    
    const iconType = getFileIconType(file.extension)
    switch (iconType) {
      case 'part':
        return <FileBox size={32} className="text-pdm-accent" />
      case 'assembly':
        return <Layers size={32} className="text-amber-400" />
      case 'drawing':
        return <FilePen size={32} className="text-sky-300" />
      case 'step':
        return <FileBox size={32} className="text-orange-400" />
      case 'pdf':
        return <FileType size={32} className="text-red-400" />
      case 'image':
        return <FileImage size={32} className="text-purple-400" />
      case 'spreadsheet':
        return <FileSpreadsheet size={32} className="text-green-400" />
      case 'archive':
        return <FileArchive size={32} className="text-yellow-500" />
      case 'schematic':
        return <Cpu size={32} className="text-red-400" />
      case 'library':
        return <Cpu size={32} className="text-violet-400" />
      case 'pcb':
        return <Cpu size={32} className="text-emerald-400" />
      case 'code':
        return <FileCode size={32} className="text-sky-400" />
      case 'text':
        return <FileText size={32} className="text-pdm-fg-muted" />
      default:
        return <File size={32} className="text-pdm-fg-muted" />
    }
  }

  const tabs = [
    { id: 'properties', label: 'Properties' },
    { id: 'whereused', label: 'Where Used' },
    { id: 'contains', label: 'Contains' },
    { id: 'history', label: 'History' },
  ] as const

  return (
    <div 
      className="bg-pdm-panel border-t border-pdm-border flex flex-col"
      style={{ height: detailsPanelHeight }}
    >
      {/* Tabs */}
      <div className="tabs flex-shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab ${detailsPanelTab === tab.id ? 'active' : ''}`}
            onClick={() => setDetailsPanelTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {selectedFiles.length === 0 ? (
          <div className="text-sm text-pdm-fg-muted text-center py-8">
            Select a file to view details
          </div>
        ) : selectedFiles.length > 1 ? (
          <div className="text-sm text-pdm-fg-muted text-center py-8">
            {selectedFiles.length} files selected
          </div>
        ) : file && (
          <>
            {detailsPanelTab === 'properties' && (
              <div className="flex gap-6">
                {/* File icon and name */}
                <div className="flex items-start gap-4 flex-shrink-0">
                  {getFileIcon()}
                  <div>
                    <div className="font-semibold text-lg">{file.name}</div>
                    <div className="text-sm text-pdm-fg-muted">{file.relativePath}</div>
                    {file.pdmData?.state && (
                      <span className={`state-badge ${file.pdmData.state.replace('_', '-')} mt-2`}>
                        {STATE_INFO[file.pdmData.state]?.label}
                      </span>
                    )}
                  </div>
                </div>

                {/* Properties grid */}
                <div className="flex-1 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                  <PropertyItem 
                    icon={<Tag size={14} />}
                    label="Item Number"
                    value={file.pdmData?.part_number || '-'}
                  />
                  <PropertyItem 
                    icon={<Hash size={14} />}
                    label="Revision"
                    value={file.pdmData?.revision || 'A'}
                  />
                  <PropertyItem 
                    icon={<Hash size={14} />}
                    label="Version"
                    value={String(file.pdmData?.version || 1)}
                  />
                  <PropertyItem 
                    icon={<Info size={14} />}
                    label="Type"
                    value={file.extension ? file.extension.replace('.', '').toUpperCase() : 'Folder'}
                  />
                  <PropertyItem 
                    icon={<Clock size={14} />}
                    label="Modified"
                    value={file.modifiedTime ? (() => {
                      try {
                        const date = new Date(file.modifiedTime)
                        return isNaN(date.getTime()) ? '-' : format(date, 'MMM d, yyyy HH:mm')
                      } catch { return '-' }
                    })() : '-'}
                  />
                  <PropertyItem 
                    icon={<Info size={14} />}
                    label="Size"
                    value={file.isDirectory ? '-' : formatFileSize(file.size)}
                  />
                  <PropertyItem 
                    icon={<User size={14} />}
                    label="Checked Out"
                    value={file.pdmData?.checked_out_by ? 
                      ((file.pdmData as any).checked_out_user?.full_name || 
                       (file.pdmData as any).checked_out_user?.email || 
                       'Someone') 
                      : 'Not checked out'}
                  />
                  <PropertyItem 
                    icon={<Cloud size={14} />}
                    label="Sync Status"
                    value={file.pdmData ? 'Synced' : 'Local only'}
                  />
                </div>
              </div>
            )}

            {detailsPanelTab === 'whereused' && (
              <div className="text-sm text-pdm-fg-muted text-center py-8">
                Where Used analysis shows which assemblies reference this part.
                <br />
                <span className="text-pdm-accent">Coming soon with Supabase integration</span>
              </div>
            )}

            {detailsPanelTab === 'contains' && (
              <div className="text-sm text-pdm-fg-muted text-center py-8">
                Contains shows the Bill of Materials for assemblies.
                <br />
                <span className="text-pdm-accent">Coming soon with Supabase integration</span>
              </div>
            )}

            {detailsPanelTab === 'history' && (
              <div>
                {!file.pdmData ? (
                  <div className="text-sm text-pdm-fg-muted text-center py-8">
                    File not synced - no version history available
                  </div>
                ) : isLoadingVersions ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="animate-spin text-pdm-fg-muted" size={24} />
                  </div>
                ) : versions.length === 0 ? (
                  <div className="text-sm text-pdm-fg-muted text-center py-8">
                    No version history
                  </div>
                ) : (
                  <div className="space-y-2">
                    {versions.map((version, index) => {
                      const isLatest = index === 0
                      const isCurrent = file.pdmData?.version === version.version
                      const canRollback = !isLatest && file.pdmData?.checked_out_by === user?.id
                      
                      return (
                        <div
                          key={version.id}
                          className={`p-3 rounded-lg border transition-colors ${
                            isCurrent 
                              ? 'bg-pdm-accent/10 border-pdm-accent' 
                              : 'bg-pdm-bg-light border-pdm-border hover:border-pdm-border-light'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <FileText size={14} className="text-pdm-accent" />
                              <span className="text-sm font-medium">
                                Version {version.version}
                              </span>
                              {isLatest && (
                                <span className="px-1.5 py-0.5 text-xs bg-pdm-success/20 text-pdm-success rounded">
                                  Latest
                                </span>
                              )}
                              {isCurrent && !isLatest && (
                                <span className="px-1.5 py-0.5 text-xs bg-pdm-accent/20 text-pdm-accent rounded">
                                  Current
                                </span>
                              )}
                              <span className="text-xs text-pdm-fg-muted">
                                Rev {version.revision}
                              </span>
                            </div>
                            
                            {canRollback && (
                              <button
                                onClick={() => handleRollback(version.version)}
                                disabled={rollingBack !== null}
                                className="flex items-center gap-1 px-2 py-1 text-xs bg-pdm-warning/20 text-pdm-warning rounded hover:bg-pdm-warning/30 transition-colors disabled:opacity-50"
                                title="Rollback to this version"
                              >
                                {rollingBack === version.version ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <RotateCcw size={12} />
                                )}
                                Rollback
                              </button>
                            )}
                          </div>
                          
                          {version.comment && (
                            <div className="text-sm text-pdm-fg-dim mb-2 pl-6">
                              "{version.comment}"
                            </div>
                          )}
                          
                          <div className="flex flex-wrap items-center gap-4 text-xs text-pdm-fg-muted pl-6">
                            <div className="flex items-center gap-1">
                              <User size={12} />
                              <span>{version.created_by_user?.full_name || version.created_by_user?.email || 'Unknown'}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Clock size={12} />
                              <span title={version.created_at ? format(new Date(version.created_at), 'MMM d, yyyy HH:mm:ss') : '-'}>
                                {formatDistanceToNow(new Date(version.created_at), { addSuffix: true })}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Info size={12} />
                              <span>{formatFileSize(version.file_size)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    
                    {file.pdmData?.checked_out_by !== user?.id && versions.length > 1 && (
                      <div className="text-xs text-pdm-fg-muted text-center py-2 border-t border-pdm-border mt-4">
                        <span className="text-pdm-warning">Check out the file to enable rollback</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface PropertyItemProps {
  icon: React.ReactNode
  label: string
  value: string
}

function PropertyItem({ icon, label, value }: PropertyItemProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-pdm-fg-muted">{icon}</span>
      <span className="text-pdm-fg-muted">{label}:</span>
      <span className="text-pdm-fg">{value}</span>
    </div>
  )
}
