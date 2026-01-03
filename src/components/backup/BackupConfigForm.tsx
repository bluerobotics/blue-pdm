import {
  Settings,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Key,
  Info,
  ExternalLink,
  CheckCircle2,
  Loader2,
  Download,
  Upload,
  AlertTriangle
} from 'lucide-react'
import { TIME_SLOTS } from './constants'

interface BackupConfigFormProps {
  showConfig: boolean
  onToggleConfig: () => void
  // Provider settings
  provider: 'backblaze_b2' | 'aws_s3' | 'google_cloud'
  onProviderChange: (provider: 'backblaze_b2' | 'aws_s3' | 'google_cloud') => void
  bucket: string
  onBucketChange: (bucket: string) => void
  region: string
  onRegionChange: (region: string) => void
  endpoint: string
  onEndpointChange: (endpoint: string) => void
  // Credentials
  accessKey: string
  onAccessKeyChange: (key: string) => void
  secretKey: string
  onSecretKeyChange: (key: string) => void
  resticPassword: string
  onResticPasswordChange: (password: string) => void
  showSecretKey: boolean
  onShowSecretKeyChange: (show: boolean) => void
  showResticPassword: boolean
  onShowResticPasswordChange: (show: boolean) => void
  // Retention settings
  retentionDaily: number
  onRetentionDailyChange: (days: number) => void
  retentionWeekly: number
  onRetentionWeeklyChange: (weeks: number) => void
  retentionMonthly: number
  onRetentionMonthlyChange: (months: number) => void
  retentionYearly: number
  onRetentionYearlyChange: (years: number) => void
  totalRetentionPoints: number
  // Schedule settings
  scheduleEnabled: boolean
  onScheduleEnabledChange: (enabled: boolean) => void
  scheduleHour: number
  scheduleMinute: number
  onScheduleTimeChange: (hour: number, minute: number) => void
  scheduleTimezone: string
  onScheduleTimezoneChange: (timezone: string) => void
  // Actions
  isSaving: boolean
  onSave: () => void
  onExport: () => void
  onImport: () => void
}

/**
 * Admin-only backup configuration form.
 */
export function BackupConfigForm({
  showConfig,
  onToggleConfig,
  provider,
  onProviderChange,
  bucket,
  onBucketChange,
  region,
  onRegionChange,
  endpoint,
  onEndpointChange,
  accessKey,
  onAccessKeyChange,
  secretKey,
  onSecretKeyChange,
  resticPassword,
  onResticPasswordChange,
  showSecretKey,
  onShowSecretKeyChange,
  showResticPassword,
  onShowResticPasswordChange,
  retentionDaily,
  onRetentionDailyChange,
  retentionWeekly,
  onRetentionWeeklyChange,
  retentionMonthly,
  onRetentionMonthlyChange,
  retentionYearly,
  onRetentionYearlyChange,
  totalRetentionPoints,
  scheduleEnabled,
  onScheduleEnabledChange,
  scheduleHour,
  scheduleMinute,
  onScheduleTimeChange,
  scheduleTimezone,
  onScheduleTimezoneChange,
  isSaving,
  onSave,
  onExport,
  onImport
}: BackupConfigFormProps) {
  return (
    <div className="space-y-3 pt-4 border-t border-plm-border">
      <button
        onClick={onToggleConfig}
        className="flex items-center justify-between w-full text-left"
      >
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Settings className="w-4 h-4 text-plm-fg-muted" />
          Backup Configuration
          <span className="text-xs px-1.5 py-0.5 bg-plm-accent/20 text-plm-accent rounded">
            Admin
          </span>
        </h4>
        {showConfig ? (
          <ChevronUp className="w-4 h-4 text-plm-fg-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-plm-fg-muted" />
        )}
      </button>
      
      {showConfig && (
        <div className="space-y-4 p-4 rounded-lg bg-plm-bg-secondary border border-plm-border">
          {/* Provider Selection */}
          <div>
            <label className="block text-sm font-medium mb-1">Provider</label>
            <select
              value={provider}
              onChange={e => onProviderChange(e.target.value as typeof provider)}
              className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
            >
              <option value="backblaze_b2">Backblaze B2</option>
              <option value="aws_s3">Amazon S3</option>
              <option value="google_cloud">Google Cloud Storage</option>
            </select>
          </div>
          
          {/* Bucket */}
          <div>
            <label className="block text-sm font-medium mb-1">Bucket Name</label>
            <input
              type="text"
              value={bucket}
              onChange={e => onBucketChange(e.target.value)}
              placeholder="my-backup-bucket"
              className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
            />
          </div>
          
          {/* Endpoint (for S3-compatible) */}
          {provider === 'backblaze_b2' && (
            <div>
              <label className="block text-sm font-medium mb-1">S3 Endpoint</label>
              <input
                type="text"
                value={endpoint}
                onChange={e => onEndpointChange(e.target.value)}
                placeholder="s3.us-west-004.backblazeb2.com"
                className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
              />
              <p className="text-xs text-plm-fg-muted mt-1">
                Find this in your B2 bucket settings
              </p>
            </div>
          )}
          
          {/* Region (for AWS) */}
          {provider === 'aws_s3' && (
            <div>
              <label className="block text-sm font-medium mb-1">Region</label>
              <input
                type="text"
                value={region}
                onChange={e => onRegionChange(e.target.value)}
                placeholder="us-east-1"
                className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
              />
            </div>
          )}
          
          {/* Access Key */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {provider === 'backblaze_b2' ? 'Application Key ID' : 'Access Key ID'}
            </label>
            <input
              type="text"
              value={accessKey}
              onChange={e => onAccessKeyChange(e.target.value)}
              placeholder="004..."
              className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm font-mono"
            />
          </div>
          
          {/* Secret Key */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {provider === 'backblaze_b2' ? 'Application Key' : 'Secret Access Key'}
            </label>
            <div className="relative">
              <input
                type={showSecretKey ? 'text' : 'password'}
                value={secretKey}
                onChange={e => onSecretKeyChange(e.target.value)}
                placeholder="K004..."
                className="w-full px-3 py-2 pr-10 rounded bg-plm-bg-primary border border-plm-border text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => onShowSecretKeyChange(!showSecretKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
              >
                {showSecretKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          
          {/* Restic Password */}
          <div>
            <label className="block text-sm font-medium mb-1 flex items-center gap-1">
              <Key className="w-3 h-3" />
              Encryption Password
            </label>
            <div className="relative">
              <input
                type={showResticPassword ? 'text' : 'password'}
                value={resticPassword}
                onChange={e => onResticPasswordChange(e.target.value)}
                placeholder="Strong password for encrypting backups"
                className="w-full px-3 py-2 pr-10 rounded bg-plm-bg-primary border border-plm-border text-sm"
              />
              <button
                type="button"
                onClick={() => onShowResticPasswordChange(!showResticPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
              >
                {showResticPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-plm-fg-muted mt-1">
              This password encrypts your backups. <strong>Store it safely!</strong>
            </p>
          </div>
          
          {/* Retention Policy */}
          <div>
            <label className="block text-sm font-medium mb-2">Retention Policy</label>
            <p className="text-xs text-plm-fg-muted mb-3">How long to keep backups on the server</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-plm-fg-muted mb-1">Keep daily for</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={retentionDaily}
                    onChange={e => onRetentionDailyChange(parseInt(e.target.value) || 14)}
                    className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
                  />
                  <span className="text-xs text-plm-fg-muted whitespace-nowrap">days</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-plm-fg-muted mb-1">Keep weekly for</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="52"
                    value={retentionWeekly}
                    onChange={e => onRetentionWeeklyChange(parseInt(e.target.value) || 10)}
                    className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
                  />
                  <span className="text-xs text-plm-fg-muted whitespace-nowrap">weeks</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-plm-fg-muted mb-1">Keep monthly for</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="24"
                    value={retentionMonthly}
                    onChange={e => onRetentionMonthlyChange(parseInt(e.target.value) || 12)}
                    className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
                  />
                  <span className="text-xs text-plm-fg-muted whitespace-nowrap">months</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-plm-fg-muted mb-1">Keep yearly for</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={retentionYearly}
                    onChange={e => onRetentionYearlyChange(parseInt(e.target.value) || 5)}
                    className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
                  />
                  <span className="text-xs text-plm-fg-muted whitespace-nowrap">years</span>
                </div>
              </div>
            </div>
            <p className="text-xs text-plm-fg-muted mt-2">
              ≈ {totalRetentionPoints} restore points total
            </p>
          </div>
          
          {/* Schedule */}
          <div>
            <label className="flex items-center gap-2 mb-3">
              <input
                type="checkbox"
                checked={scheduleEnabled}
                onChange={e => onScheduleEnabledChange(e.target.checked)}
                className="w-4 h-4 rounded border-plm-border bg-plm-bg-primary"
              />
              <span className="text-sm font-medium">Enable scheduled backups</span>
            </label>
            
            {scheduleEnabled && (
              <div className="pl-6">
                <label className="block text-xs text-plm-fg-muted mb-1">Backup time</label>
                <div className="flex items-center gap-2">
                  <select
                    value={`${scheduleHour}:${scheduleMinute}`}
                    onChange={e => {
                      const [h, m] = e.target.value.split(':').map(Number)
                      onScheduleTimeChange(h, m)
                    }}
                    className="w-24 px-2 py-1.5 rounded bg-plm-bg-primary border border-plm-border text-sm"
                  >
                    {TIME_SLOTS.map(slot => (
                      <option key={slot.value} value={slot.value}>{slot.label}</option>
                    ))}
                  </select>
                  <select
                    value={scheduleTimezone}
                    onChange={e => onScheduleTimezoneChange(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded bg-plm-bg-primary border border-plm-border text-sm"
                  >
                    <optgroup label="Americas">
                      <option value="America/Los_Angeles">Pacific (LA)</option>
                      <option value="America/Denver">Mountain (Denver)</option>
                      <option value="America/Chicago">Central (Chicago)</option>
                      <option value="America/New_York">Eastern (NY)</option>
                      <option value="America/Sao_Paulo">São Paulo</option>
                    </optgroup>
                    <optgroup label="Europe">
                      <option value="Europe/London">London</option>
                      <option value="Europe/Paris">Paris / Berlin</option>
                      <option value="Europe/Moscow">Moscow</option>
                    </optgroup>
                    <optgroup label="Asia/Pacific">
                      <option value="Asia/Dubai">Dubai</option>
                      <option value="Asia/Kolkata">India</option>
                      <option value="Asia/Shanghai">China</option>
                      <option value="Asia/Tokyo">Tokyo</option>
                      <option value="Australia/Sydney">Sydney</option>
                    </optgroup>
                    <optgroup label="Other">
                      <option value="UTC">UTC</option>
                    </optgroup>
                  </select>
                </div>
              </div>
            )}
          </div>
          
          {/* Info Box */}
          <div className="p-3 rounded bg-blue-500/10 border border-blue-500/30">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-blue-300">
                <p className="mb-1">
                  Backups use <strong>restic</strong> with deduplication, so storage usage is much lower than raw file size.
                </p>
                <a
                  href="https://www.backblaze.com/b2/cloud-storage.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300"
                >
                  Backblaze B2 Pricing
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
          
          {/* Save Button */}
          <button
            onClick={onSave}
            disabled={isSaving}
            className="w-full py-2 px-4 bg-plm-accent text-white rounded font-medium hover:bg-plm-accent-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Save Configuration
              </>
            )}
          </button>
          
          {/* Export/Import buttons */}
          <div className="flex gap-2">
            <button
              onClick={onExport}
              className="flex-1 py-2 px-4 bg-plm-bg-tertiary text-plm-fg rounded font-medium hover:bg-plm-bg-primary border border-plm-border flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export Config
            </button>
            <button
              onClick={onImport}
              className="flex-1 py-2 px-4 bg-plm-bg-tertiary text-plm-fg rounded font-medium hover:bg-plm-bg-primary border border-plm-border flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Import Config
            </button>
          </div>
          
          {/* Disaster Recovery Warning */}
          <div className="p-3 rounded bg-amber-500/10 border border-amber-500/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-300">
                <p className="font-medium mb-1">Export your config as disaster recovery!</p>
                <p>
                  If Supabase goes down, the exported config file is your key to access backups.
                  Store it in a password manager or secure location.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
