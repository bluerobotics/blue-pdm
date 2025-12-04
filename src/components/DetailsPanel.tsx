import { usePDMStore } from '../stores/pdmStore'
import { formatFileSize, STATE_INFO, getFileType } from '../types/pdm'
import { format } from 'date-fns'
import { 
  FileBox, 
  Layers, 
  FileText, 
  File,
  Clock,
  User,
  GitBranch,
  Tag,
  Hash,
  Info
} from 'lucide-react'

export function DetailsPanel() {
  const { 
    selectedFiles, 
    getSelectedFileObjects, 
    detailsPanelHeight,
    detailsPanelTab,
    setDetailsPanelTab
  } = usePDMStore()

  const selectedFileObjects = getSelectedFileObjects()
  const file = selectedFileObjects.length === 1 ? selectedFileObjects[0] : null

  const getFileIcon = () => {
    if (!file) return <File size={32} className="text-pdm-fg-muted" />
    
    if (file.isDirectory) {
      return <File size={32} className="text-pdm-warning" />
    }
    
    const fileType = getFileType(file.extension)
    switch (fileType) {
      case 'part':
        return <FileBox size={32} className="text-pdm-accent" />
      case 'assembly':
        return <Layers size={32} className="text-pdm-success" />
      case 'drawing':
        return <FileText size={32} className="text-pdm-info" />
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
                    label="Part Number"
                    value={file.pdmData?.part_number || '-'}
                  />
                  <PropertyItem 
                    icon={<Hash size={14} />}
                    label="Revision"
                    value={file.pdmData?.revision || 'A'}
                  />
                  <PropertyItem 
                    icon={<GitBranch size={14} />}
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
                    value={format(new Date(file.modifiedTime), 'MMM d, yyyy HH:mm')}
                  />
                  <PropertyItem 
                    icon={<Info size={14} />}
                    label="Size"
                    value={file.isDirectory ? '-' : formatFileSize(file.size)}
                  />
                  <PropertyItem 
                    icon={<User size={14} />}
                    label="Checked Out"
                    value={file.pdmData?.checked_out_by || 'Not checked out'}
                  />
                  <PropertyItem 
                    icon={<GitBranch size={14} />}
                    label="Git Status"
                    value={file.gitStatus || 'Committed'}
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
              <div className="text-sm text-pdm-fg-muted text-center py-8">
                File version history with rollback capability.
                <br />
                <span className="text-pdm-accent">View history in the sidebar for now</span>
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
