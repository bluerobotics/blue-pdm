import { useState, useMemo, useRef, useEffect } from 'react'
import * as LucideIcons from 'lucide-react'
import { Search, ChevronDown, X } from 'lucide-react'

// Comprehensive icon list organized by category - deduplicated
const ICON_LIBRARY_RAW = [
  // People & Teams (35)
  'Users', 'UsersRound', 'UserCog', 'UserCheck', 'UserPlus', 'UserMinus', 'UserX', 'User',
  'UserCircle', 'UserCircle2', 'UserSquare', 'UserSquare2', 'UserSearch', 'UserRound',
  'UserRoundCog', 'UserRoundCheck', 'UserRoundPlus', 'UserRoundMinus', 'UserRoundX', 'UserRoundSearch',
  'Contact', 'Contact2', 'ContactRound', 'PersonStanding', 'Accessibility', 'Baby',
  'Handshake', 'HeartHandshake', 'Hand', 'HandMetal', 'ThumbsUp', 'ThumbsDown',
  'Pointer', 'PointerOff', 'Grab',

  // Security & Admin (30)
  'Shield', 'ShieldCheck', 'ShieldAlert', 'ShieldQuestion', 'ShieldOff', 'ShieldPlus',
  'ShieldMinus', 'ShieldBan', 'ShieldHalf', 'ShieldEllipsis',
  'Lock', 'LockKeyhole', 'LockOpen', 'Unlock', 'UnlockKeyhole',
  'Key', 'KeyRound', 'KeySquare', 'Fingerprint', 'ScanFace', 'ScanLine', 'ScanText',
  'Eye', 'EyeOff', 'EyeClosed', 'Scan', 'QrCode', 'Barcode', 'CircleDot', 'CircleDotDashed',

  // Status & Achievements (40)
  'Star', 'StarOff', 'StarHalf', 'Stars', 'Sparkle', 'Sparkles',
  'Crown', 'Award', 'Trophy', 'Medal', 'BadgeCheck', 'Badge', 'BadgeAlert', 'BadgeDollarSign',
  'BadgeHelp', 'BadgeInfo', 'BadgeMinus', 'BadgePlus', 'BadgePercent', 'BadgeX',
  'Gem', 'Diamond', 'Heart', 'HeartCrack', 'HeartOff', 'HeartPulse',
  'Flame', 'FlameKindling', 'Leaf', 'LeafyGreen', 'Clover', 'Sprout', 'TreeDeciduous', 'TreePine',
  'Sun', 'SunDim', 'SunMedium', 'SunMoon', 'Moon', 'MoonStar',

  // Buildings & Places (40)
  'Building', 'Building2', 'BuildingIcon', 'Factory', 'Warehouse', 'Store', 'StoreIcon',
  'Hotel', 'School', 'School2', 'GraduationCap', 'Church', 'Castle', 'Landmark', 'LandmarkIcon',
  'Home', 'HomeIcon', 'House', 'HousePlus', 'HouseIcon', 'Tent', 'TentTree', 'Fence',
  'Trees', 'PalmTree', 'Flower', 'Flower2', 'Mountain', 'MountainSnow',
  'Waves', 'Wind', 'Cloud', 'CloudSun', 'CloudMoon', 'CloudRain', 'CloudSnow', 'CloudFog',
  'Snowflake', 'Sunrise',

  // Work & Business (45)
  'Briefcase', 'BriefcaseBusiness', 'BriefcaseMedical', 'BriefcaseConveyorBelt',
  'Suitcase', 'SuitcaseRolling', 'Wallet', 'WalletCards', 'WalletMinimal',
  'PiggyBank', 'Banknote', 'CircleDollarSign', 'DollarSign',
  'CreditCard', 'Receipt', 'ReceiptText', 'HandCoins', 'Coins', 'Bitcoin',
  'TrendingUp', 'TrendingDown', 'TrendingUpDown',
  'BarChart', 'BarChart2', 'BarChart3', 'BarChart4', 'BarChartBig', 'BarChartHorizontal', 'BarChartHorizontalBig',
  'PieChart', 'LineChart', 'ChartArea', 'ChartBar', 'ChartBarBig', 'ChartBarDecreasing',
  'ChartBarIncreasing', 'ChartBarStacked', 'ChartCandlestick', 'ChartColumn',
  'ChartColumnBig', 'ChartColumnDecreasing', 'ChartColumnIncreasing', 'ChartColumnStacked',
  'ChartGantt',

  // Engineering & Tools (45)
  'Wrench', 'WrenchIcon', 'Hammer', 'HammerIcon', 'Screwdriver', 'Drill',
  'PenTool', 'PenLine', 'Paintbrush', 'PaintbrushIcon', 'PaintbrushVertical', 'Paintbucket',
  'Palette', 'Pipette', 'Ruler', 'RulerIcon', 'Pencil', 'PencilLine', 'PencilRuler', 'PencilOff',
  'Settings', 'Settings2', 'SettingsIcon', 'Cog', 'CogIcon',
  'SlidersHorizontal', 'SlidersVertical', 'Sliders',
  'Gauge', 'GaugeCircle', 'Compass', 'CompassIcon', 'Magnet',
  'Scissors', 'ScissorsIcon', 'ScissorsLineDashed', 'Eraser',
  'Crop', 'Move', 'Move3D', 'MoveDiagonal', 'MoveDiagonal2', 'MoveHorizontal', 'MoveVertical',
  'Maximize', 'Maximize2', 'Minimize', 'Minimize2',

  // Technology & Code (50)
  'Code', 'Code2', 'CodeXml', 'Braces', 'Brackets', 'Terminal', 'TerminalSquare',
  'Cpu', 'CpuIcon', 'CircuitBoard', 'Binary', 'Bug', 'BugOff', 'BugPlay',
  'Database', 'DatabaseBackup', 'DatabaseZap', 'Server', 'ServerCog', 'ServerCrash', 'ServerOff',
  'HardDrive', 'HardDriveDownload', 'HardDriveUpload',
  'Monitor', 'MonitorCheck', 'MonitorDot', 'MonitorDown', 'MonitorOff', 'MonitorPause',
  'MonitorPlay', 'MonitorSmartphone', 'MonitorSpeaker', 'MonitorStop', 'MonitorUp', 'MonitorX',
  'Laptop', 'Laptop2', 'LaptopMinimal', 'LaptopMinimalCheck',
  'Smartphone', 'SmartphoneCharging', 'SmartphoneNfc',
  'Tablet', 'TabletSmartphone', 'Tablets',
  'Wifi', 'WifiHigh', 'WifiLow', 'WifiOff', 'WifiZero',
  'Bluetooth', 'BluetoothConnected', 'BluetoothOff', 'BluetoothSearching',

  // Network & Connectivity (30)
  'Radio', 'RadioReceiver', 'RadioTower', 'Antenna', 'Satellite', 'SatelliteDish',
  'Signal', 'SignalHigh', 'SignalLow', 'SignalMedium', 'SignalZero',
  'Router', 'Network', 'Globe', 'Globe2', 'GlobeIcon', 'GlobeLock', 'Earth', 'EarthLock',
  'Cable', 'CableCar', 'Ethernet', 'Nfc', 'Usb',
  'Share', 'Share2', 'ShareIcon', 'ExternalLink', 'Link', 'Link2', 'LinkIcon', 'Unlink', 'Unlink2',

  // Science & Research (40)
  'Microscope', 'Beaker', 'FlaskConical', 'FlaskConicalOff', 'FlaskRound', 'TestTube', 'TestTubes', 'TestTubeDiagonal',
  'Atom', 'AtomIcon', 'Dna', 'DnaOff', 'Pill', 'PillBottle', 'Syringe', 'Stethoscope',
  'Activity', 'ActivityIcon', 'ActivitySquare',
  'Brain', 'BrainCircuit', 'BrainCog', 'Bone',
  'Radiation', 'Biohazard', 'Orbit', 'Telescope', 'Aperture',
  'ThermometerSun', 'Thermometer', 'ThermometerSnowflake',
  'Scale', 'Scale3D', 'ScaleIcon', 'Scaling',
  'Calculator', 'CalculatorIcon', 'Sigma', 'Pi', 'Infinity', 'Variable', 'Hash', 'Percent',

  // Documents & Files (50)
  'File', 'FileText', 'FileCheck', 'FileCheck2', 'FileCode', 'FileCode2', 'FileCog', 'FileCog2',
  'FileDiff', 'FileDigit', 'FileDown', 'FileHeart', 'FileImage', 'FileInput', 'FileJson', 'FileJson2',
  'FileKey', 'FileKey2', 'FileLock', 'FileLock2', 'FileMinus', 'FileMinus2', 'FileMusic',
  'FileOutput', 'FilePen', 'FilePenLine', 'FilePlus', 'FilePlus2', 'FileQuestion',
  'Files', 'FileS', 'FileScan', 'FileSearch', 'FileSearch2', 'FileSliders',
  'FileSpreadsheet', 'FileStack', 'FileSymlink', 'FileTerminal', 'FileType', 'FileType2',
  'FileUp', 'FileVideo', 'FileVideo2', 'FileVolume', 'FileVolume2', 'FileWarning', 'FileX', 'FileX2',
  'Folder', 'FolderArchive', 'FolderCheck', 'FolderClock', 'FolderClosed', 'FolderCog', 'FolderCog2',
  'FolderDot', 'FolderDown', 'FolderEdit', 'FolderGit', 'FolderGit2', 'FolderHeart',
  'FolderInput', 'FolderKanban', 'FolderKey', 'FolderLock', 'FolderMinus', 'FolderOpen', 'FolderOpenDot',
  'FolderOutput', 'FolderPen', 'FolderPlus', 'FolderRoot', 'FolderSearch', 'FolderSearch2',
  'FolderSymlink', 'FolderSync', 'FolderTree', 'FolderUp', 'FolderX', 'Folders',

  // Clipboard & Notes (20)
  'ClipboardList', 'Clipboard', 'ClipboardCheck', 'ClipboardCopy', 'ClipboardEdit',
  'ClipboardMinus', 'ClipboardPaste', 'ClipboardPen', 'ClipboardPenLine', 'ClipboardPlus',
  'ClipboardSignature', 'ClipboardType', 'ClipboardX',
  'BookOpen', 'BookOpenCheck', 'BookOpenText', 'Book', 'BookA', 'BookAudio', 'BookCheck',
  'BookCopy', 'BookDashed', 'BookDown', 'BookHeadphones', 'BookHeart', 'BookImage',
  'BookKey', 'BookLock', 'BookMarked', 'BookMinus', 'BookPlus',
  'BookText', 'BookType', 'BookUp', 'BookUp2', 'BookUser', 'BookX', 'Books',
  'Library', 'LibraryBig', 'LibrarySquare',
  'Notebook', 'NotebookPen', 'NotebookTabs', 'NotebookText',
  'ScrollText', 'Scroll', 'StickyNote', 'NotepadText', 'NotepadTextDashed',

  // Logistics & Shipping (45)
  'Box', 'Boxes', 'BoxIcon', 'BoxSelect', 'Package', 'Package2', 'PackageCheck', 'PackageMinus',
  'PackageOpen', 'PackagePlus', 'PackageSearch', 'PackageX',
  'Truck', 'TruckIcon', 'Forklift', 'Container', 'ContainerIcon',
  'Car', 'CarFront', 'CarTaxiFront', 'Bus', 'BusFront',
  'Plane', 'PlaneLanding', 'PlaneTakeoff', 'PlaneIcon',
  'Ship', 'ShipWheel', 'Sailboat', 'Anchor', 'AnchorIcon',
  'Train', 'TrainFront', 'TrainTrack', 'TramFront',
  'Bike', 'Bicycle',
  'ShoppingCart', 'ShoppingBag', 'ShoppingBasket',
  'ScanBarcode',
  'Navigation', 'Navigation2', 'NavigationOff', 'MapPin', 'MapPinOff', 'MapPinPlus', 'MapPinMinus',
  'MapPinCheck', 'MapPinX', 'MapPinHouse', 'MapPinned', 'MapPinnedOff',
  'Route', 'RouteOff', 'Milestone', 'Signpost', 'SignpostBig',

  // Communication (40)
  'Mail', 'MailCheck', 'MailMinus', 'MailOpen', 'MailPlus', 'MailQuestion', 'MailSearch',
  'MailWarning', 'MailX', 'Mails', 'Mailbox',
  'Send', 'SendHorizontal', 'SendToBack', 'Forward', 'ForwardIcon',
  'Inbox', 'Archive', 'ArchiveRestore', 'ArchiveX',
  'MessageSquare', 'MessageSquareCode', 'MessageSquareDashed', 'MessageSquareDiff',
  'MessageSquareDot', 'MessageSquareHeart', 'MessageSquareLock', 'MessageSquareMore',
  'MessageSquareOff', 'MessageSquarePlus', 'MessageSquareQuote', 'MessageSquareReply',
  'MessageSquareShare', 'MessageSquareText', 'MessageSquareWarning', 'MessageSquareX',
  'MessageCircle', 'MessageCircleCode', 'MessageCircleDashed', 'MessageCircleHeart',
  'MessageCircleMore', 'MessageCircleOff', 'MessageCirclePlus', 'MessageCircleQuestion',
  'MessageCircleReply', 'MessageCircleWarning', 'MessageCircleX',
  'MessagesSquare', 'Phone', 'PhoneCall', 'PhoneForwarded', 'PhoneIncoming',
  'PhoneMissed', 'PhoneOff', 'PhoneOutgoing', 'Voicemail',

  // Media & Entertainment (50)
  'Video', 'VideoIcon', 'VideoOff', 'Camera', 'CameraOff', 'CameraIcon',
  'Mic', 'MicOff', 'MicVocal', 'Headphones', 'HeadphoneOff', 'Headset',
  'Bell', 'BellDot', 'BellMinus', 'BellOff', 'BellPlus', 'BellRing', 'BellElectric',
  'Megaphone', 'MegaphoneOff', 'Podcast', 'Rss', 'RssIcon',
  'Music', 'Music2', 'Music3', 'Music4', 'Disc', 'Disc2', 'Disc3', 'DiscAlbum',
  'Play', 'PlayCircle', 'PlaySquare', 'PlayIcon',
  'Pause', 'PauseCircle', 'PauseOctagon', 'PauseIcon',
  'Stop', 'StopCircle', 'Square', 'SquareIcon',
  'FastForward', 'Rewind', 'SkipBack', 'SkipForward',
  'Volume', 'Volume1', 'Volume2', 'VolumeOff', 'VolumeX',
  'Film', 'Clapperboard', 'Tv', 'Tv2', 'TvIcon', 'TvMinimal', 'TvMinimalPlay',
  'Gamepad', 'Gamepad2', 'Joystick', 'Dices', 'Dice1', 'Dice2', 'Dice3', 'Dice4', 'Dice5', 'Dice6',
  'Puzzle', 'PuzzleIcon',

  // Creative & Design (35)
  'Brush', 'BrushIcon', 'Highlighter', 'HighlighterIcon',
  'Slice', 'Shapes', 'Circle', 'Triangle', 'TriangleAlert',
  'Hexagon', 'Pentagon', 'Octagon', 'OctagonAlert', 'OctagonMinus', 'OctagonPause', 'OctagonX',
  'Spade', 'Club', 'Layers', 'Layers2', 'Layers3',
  'Grid2X2', 'Grid2X2Check', 'Grid2X2Plus', 'Grid2X2X', 'Grid3X3',
  'LayoutGrid', 'LayoutList', 'LayoutDashboard', 'LayoutTemplate', 'LayoutPanelLeft',
  'LayoutPanelTop', 'Layout', 'AlignCenter', 'AlignJustify', 'AlignLeft', 'AlignRight',

  // Nature & Environment (35)
  'Map', 'MapIcon',
  'Droplet', 'Droplets',
  'Tornado', 'Umbrella', 'UmbrellaOff',
  'Cherry', 'Apple', 'Banana', 'Citrus',
  'Grape', 'Lemon', 'Carrot', 'Salad', 'Wheat', 'WheatOff',
  'Shrub', 'Vegan', 'LeafIcon',

  // Energy & Power (25)
  'Zap', 'ZapOff', 'ZapIcon', 'Bolt', 'BoltIcon',
  'Battery', 'BatteryCharging', 'BatteryFull', 'BatteryLow', 'BatteryMedium', 'BatteryWarning',
  'Plug', 'PlugZap', 'PlugZap2', 'Unplug',
  'Power', 'PowerOff', 'PowerCircle', 'PowerSquare',
  'Lightbulb', 'LightbulbOff', 'LampDesk', 'LampFloor', 'LampCeiling', 'LampWallDown', 'LampWallUp',
  'Flashlight', 'FlashlightOff',
  'Rocket', 'Fuel', 'FuelIcon',

  // Food & Dining (30)
  'Utensils', 'UtensilsCrossed', 'ChefHat',
  'CookingPot', 'Soup', 'Pizza', 'Sandwich', 'Beef', 'Ham', 'Drumstick',
  'Coffee', 'CoffeeIcon', 'Milk', 'MilkOff',
  'Wine', 'WineOff', 'Beer', 'BeerOff', 'Martini', 'GlassWater',
  'IceCream', 'IceCreamBowl', 'IceCreamCone', 'Cake', 'CakeSlice', 'Cookie', 'Croissant',
  'Candy', 'CandyCane', 'Lollipop', 'Popcorn',

  // Sports & Fitness (25)
  'Dumbbell', 'Footprints',
  'Timer', 'TimerOff', 'TimerReset',
  'Stopwatch', 'Clock', 'Clock1', 'Clock2', 'Clock3', 'Clock4', 'Clock5',
  'Clock6', 'Clock7', 'Clock8', 'Clock9', 'Clock10', 'Clock11', 'Clock12',
  'Alarm', 'AlarmCheck', 'AlarmClock', 'AlarmClockCheck', 'AlarmClockMinus', 'AlarmClockOff', 'AlarmClockPlus',
  'AlarmMinus', 'AlarmPlus', 'AlarmSmoke',
  'Watch', 'WatchIcon',
  'Flag', 'FlagOff', 'FlagTriangleLeft', 'FlagTriangleRight', 'Goal',

  // Health & Safety (30)
  'Cross', 'CirclePlus', 'Plus', 'PlusCircle', 'PlusSquare',
  'AlertTriangle', 'AlertCircle', 'AlertOctagon', 'CircleAlert',
  'HardHat', 'Construction', 'Cone', 'TrafficCone',
  'CircleCheck', 'CircleX',
  'CheckCircle', 'CheckCircle2', 'XCircle',

  // Miscellaneous (40)
  'Gift', 'GiftIcon', 'PartyPopper', 'Confetti',
  'Balloon', 'Wand', 'Wand2', 'WandSparkles',
  'Glasses', 'Sunglasses', 'Hourglass', 'HourglassIcon',
  'Calendar', 'CalendarCheck', 'CalendarCheck2', 'CalendarClock', 'CalendarDays',
  'CalendarFold', 'CalendarHeart', 'CalendarMinus', 'CalendarOff', 'CalendarPlus',
  'CalendarRange', 'CalendarSearch', 'CalendarX', 'CalendarX2',
  'Bot', 'BotIcon', 'BotMessageSquare', 'BotOff',
  'Ghost', 'Skull', 'SkullIcon',
  'Cat', 'Dog', 'Bird', 'Fish', 'Rabbit', 'Squirrel', 'Rat', 'Snail', 'Turtle', 'Worm',

  // Arrows & Navigation (30)
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ArrowUpDown', 'ArrowLeftRight', 'ArrowUpLeft', 'ArrowUpRight', 'ArrowDownLeft', 'ArrowDownRight',
  'ChevronUp', 'ChevronDown', 'ChevronLeft', 'ChevronRight',
  'ChevronsUp', 'ChevronsDown', 'ChevronsLeft', 'ChevronsRight',
  'ChevronUpDown', 'ChevronLeftRight',
  'ArrowBigUp', 'ArrowBigDown', 'ArrowBigLeft', 'ArrowBigRight',
  'CornerUpLeft', 'CornerUpRight', 'CornerDownLeft', 'CornerDownRight',
  'Undo', 'Undo2', 'Redo', 'Redo2', 'RotateCw', 'RotateCcw', 'RefreshCw', 'RefreshCcw',

  // UI Elements (25)
  'Menu', 'MenuIcon', 'MenuSquare', 'MoreHorizontal', 'MoreVertical', 'Ellipsis', 'EllipsisVertical',
  'GripHorizontal', 'GripVertical', 'Grip',
  'PanelLeft', 'PanelLeftClose', 'PanelLeftOpen', 'PanelRight', 'PanelRightClose', 'PanelRightOpen',
  'PanelTop', 'PanelTopClose', 'PanelTopOpen', 'PanelBottom', 'PanelBottomClose', 'PanelBottomOpen',
  'SidebarClose', 'SidebarOpen', 'Sidebar',
  'Expand', 'Shrink', 'Fullscreen', 'PictureInPicture', 'PictureInPicture2',
]

// Deduplicate the icon library to prevent React key warnings
export const ICON_LIBRARY = [...new Set(ICON_LIBRARY_RAW)]

// Categories for organized browsing
export const ICON_CATEGORIES = {
  'People & Teams': ICON_LIBRARY.slice(0, 35),
  'Security': ICON_LIBRARY.slice(35, 65),
  'Status & Achievements': ICON_LIBRARY.slice(65, 105),
  'Buildings': ICON_LIBRARY.slice(105, 145),
  'Business': ICON_LIBRARY.slice(145, 190),
  'Tools': ICON_LIBRARY.slice(190, 235),
  'Technology': ICON_LIBRARY.slice(235, 285),
  'Network': ICON_LIBRARY.slice(285, 315),
  'Science': ICON_LIBRARY.slice(315, 355),
  'Files & Folders': ICON_LIBRARY.slice(355, 455),
  'Logistics': ICON_LIBRARY.slice(455, 500),
  'Communication': ICON_LIBRARY.slice(500, 540),
  'Media': ICON_LIBRARY.slice(540, 590),
  'Other': ICON_LIBRARY.slice(590),
}

// Props for the icon picker component
interface IconPickerProps {
  value: string
  onChange: (icon: string) => void
  color?: string
  className?: string
  showLabel?: boolean
  dropdownPosition?: 'bottom' | 'top'
}

// Dropdown icon picker (button + dropdown)
export function IconPicker({
  value,
  onChange,
  color = 'currentColor',
  className = '',
  showLabel = true,
  dropdownPosition = 'bottom'
}: IconPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const IconComponent = (LucideIcons as any)[value] || LucideIcons.HelpCircle
  
  // Filter icons based on search
  const filteredIcons = useMemo(() => {
    if (!search.trim()) return ICON_LIBRARY
    const searchLower = search.toLowerCase()
    return ICON_LIBRARY.filter(icon => icon.toLowerCase().includes(searchLower))
  }, [search])
  
  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])
  
  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg flex items-center gap-2 hover:border-plm-accent transition-colors"
        style={{ color }}
      >
        <IconComponent size={18} />
        {showLabel && <span className="text-plm-fg text-sm flex-1 text-left">{value}</span>}
        <ChevronDown size={14} className={`text-plm-fg-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <div 
          className={`absolute z-50 ${dropdownPosition === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 bg-plm-bg border border-plm-border rounded-lg shadow-xl p-2 w-80`}
        >
          {/* Search input */}
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search icons..."
              className="w-full pl-8 pr-8 py-1.5 text-sm bg-plm-bg-secondary border border-plm-border rounded text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
              autoFocus
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
              >
                <X size={14} />
              </button>
            )}
          </div>
          
          {/* Icon count */}
          <div className="text-[10px] text-plm-fg-dim mb-1.5 px-1">
            {filteredIcons.length} icons {search && `matching "${search}"`}
          </div>
          
          {/* Icons grid */}
          <div className="max-h-64 overflow-y-auto">
            <div className="grid grid-cols-8 gap-1">
              {filteredIcons.map(iconName => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const Icon = (LucideIcons as any)[iconName]
                if (!Icon) return null
                return (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => {
                      onChange(iconName)
                      setIsOpen(false)
                      setSearch('')
                    }}
                    className={`p-1.5 rounded transition-colors ${
                      value === iconName
                        ? 'bg-plm-accent/20 text-plm-accent'
                        : 'hover:bg-plm-highlight text-plm-fg-muted hover:text-plm-fg'
                    }`}
                    title={iconName}
                  >
                    <Icon size={16} />
                  </button>
                )
              })}
            </div>
            {filteredIcons.length === 0 && (
              <div className="text-center text-sm text-plm-fg-muted py-6">
                No icons match "{search}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Inline icon grid picker (no dropdown, shows full grid)
interface IconGridPickerProps {
  value: string
  onChange: (icon: string) => void
  className?: string
  maxHeight?: string
  columns?: number
}

export function IconGridPicker({
  value,
  onChange,
  className = '',
  maxHeight = '160px',
  columns = 8
}: IconGridPickerProps) {
  const [search, setSearch] = useState('')
  
  // Filter icons based on search
  const filteredIcons = useMemo(() => {
    if (!search.trim()) return ICON_LIBRARY
    const searchLower = search.toLowerCase()
    return ICON_LIBRARY.filter(icon => icon.toLowerCase().includes(searchLower))
  }, [search])
  
  return (
    <div className={className}>
      {/* Search input */}
      <div className="relative mb-2">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search icons..."
          className="w-full pl-8 pr-8 py-2 text-sm bg-plm-bg-secondary border border-plm-border rounded text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
          >
            <X size={14} />
          </button>
        )}
      </div>
      
      {/* Icon count */}
      <div className="text-[10px] text-plm-fg-dim mb-1.5">
        {filteredIcons.length} icons {search && `matching "${search}"`}
      </div>
      
      {/* Icons grid */}
      <div 
        className="overflow-y-auto p-2 bg-plm-bg-secondary rounded border border-plm-border"
        style={{ maxHeight }}
      >
        <div className={`grid gap-1`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {filteredIcons.map(iconName => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const Icon = (LucideIcons as any)[iconName]
            if (!Icon) return null
            return (
              <button
                key={iconName}
                type="button"
                onClick={() => onChange(iconName)}
                className={`p-2 rounded transition-colors ${
                  value === iconName
                    ? 'bg-plm-accent/20 text-plm-accent'
                    : 'hover:bg-plm-highlight text-plm-fg-muted hover:text-plm-fg'
                }`}
                title={iconName}
              >
                <Icon size={16} />
              </button>
            )
          })}
        </div>
        {filteredIcons.length === 0 && (
          <div className="text-center text-sm text-plm-fg-muted py-6">
            No icons match "{search}"
          </div>
        )}
      </div>
    </div>
  )
}

// Export the icon list for direct use
export { ICON_LIBRARY as ICONS }

