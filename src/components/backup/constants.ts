export const DEFAULT_RETENTION = {
  daily: 14,
  weekly: 10,
  monthly: 12,
  yearly: 5
}

export const TIMEZONE_OPTIONS = [
  // Americas
  { value: 'America/Los_Angeles', label: 'Pacific (LA)', group: 'Americas' },
  { value: 'America/Denver', label: 'Mountain (Denver)', group: 'Americas' },
  { value: 'America/Chicago', label: 'Central (Chicago)', group: 'Americas' },
  { value: 'America/New_York', label: 'Eastern (NY)', group: 'Americas' },
  { value: 'America/Sao_Paulo', label: 'São Paulo', group: 'Americas' },
  // Europe
  { value: 'Europe/London', label: 'London', group: 'Europe' },
  { value: 'Europe/Paris', label: 'Paris / Berlin', group: 'Europe' },
  { value: 'Europe/Moscow', label: 'Moscow', group: 'Europe' },
  // Asia/Pacific
  { value: 'Asia/Dubai', label: 'Dubai', group: 'Asia/Pacific' },
  { value: 'Asia/Kolkata', label: 'India', group: 'Asia/Pacific' },
  { value: 'Asia/Shanghai', label: 'China', group: 'Asia/Pacific' },
  { value: 'Asia/Tokyo', label: 'Tokyo', group: 'Asia/Pacific' },
  { value: 'Australia/Sydney', label: 'Sydney', group: 'Asia/Pacific' },
  // Other
  { value: 'UTC', label: 'UTC', group: 'Other' }
] as const

export type TimezoneValue = typeof TIMEZONE_OPTIONS[number]['value']

// Time slots for schedule picker (every 30 minutes)
export const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2)
  const minute = (i % 2) * 30
  return {
    value: `${hour}:${minute}`,
    label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
})

export const PROVIDER_OPTIONS = [
  { value: 'backblaze_b2', label: 'Backblaze B2' },
  { value: 'aws_s3', label: 'Amazon S3' },
  { value: 'google_cloud', label: 'Google Cloud Storage' }
] as const

export type ProviderValue = typeof PROVIDER_OPTIONS[number]['value']
