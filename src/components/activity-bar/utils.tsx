import * as LucideIcons from 'lucide-react'
import { Package } from 'lucide-react'
import { GoogleDriveIcon } from './GoogleDriveIcon'

// Get the icon component for a module
export function getModuleIcon(iconName: string, size: number = 22, customColor?: string | null): React.ReactNode {
  if (iconName === 'GoogleDrive') {
    return <GoogleDriveIcon size={size} />
  }
  
  // Lookup from Lucide icons directly (same method as ModulesSettings)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const IconComponent = (LucideIcons as any)[iconName]
  
  if (IconComponent) {
    if (customColor) {
      return (
        <span style={{ color: customColor }}>
          <IconComponent size={size} />
        </span>
      )
    }
    return <IconComponent size={size} />
  }
  
  // Fallback to Package icon if not found
  return <Package size={size} />
}
