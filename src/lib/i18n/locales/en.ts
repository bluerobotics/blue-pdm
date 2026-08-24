import type { TranslationDict } from '../types'

// English translations (default/fallback)
export const en: TranslationDict = {
  app: {
    recoveredFromCrash: 'BluePLM stopped responding and reloaded. Your vault is being re-read.',
  },
  vaultLoad: {
    loading: 'Loading vault...',
    stalled: 'Still loading. This is taking longer than expected.',
    retry: 'Retry',
  },
  checkoutDisplay: {
    you: 'You',
    loadingOwner: 'Loading checkout owner',
    ownerUnavailable: 'Checkout owner unavailable',
    checkedOutBy: 'Checked out by {{name}}',
    checkedOutByOnComputer: 'Checked out by {{name}} on {{computer}}',
    anotherComputer: 'another computer',
    differentComputer: 'different computer',
    otherComputer: 'other computer',
  },
  // Item Browser expandable sections
  itemBrowser: {
    designation: 'Designation',
    source: 'Source',
    release: 'Release',
    boms: 'BOMs',
    ebom: 'eBOM',
    mbom: 'mBOM',
    quality: 'Quality',
    faiReports: 'First article inspection reports',
    imrReports: 'Incoming material inspection reports',
    noTemplateDefined: 'No template defined',
    selectTemplate: 'Select template',
    noSourceFiles: 'No source files',
    noReleaseFiles: 'No release files',
    comingSoon: 'Coming soon',
    openEbom: 'Open eBOM',
    openMbom: 'Open mBOM',
    defaultDesignation: 'Default',
    designationsTitle: 'Item Designations',
    designationsDescription:
      'Manage the list of item designations (e.g. Part, Assembly, Packed Assembly). These appear in the Item Browser and can be assigned per item.',
    addDesignation: 'Add designation',
    designationName: 'Designation name',
    noDesignations: 'No designations defined yet.',
    deleteDesignationConfirm:
      'Delete this designation? Items using it will revert to their default.',
    noPermission: 'You do not have permission to manage item designations.',
  },
  // Common
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    remove: 'Remove',
    close: 'Close',
    search: 'Search',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    warning: 'Warning',
    info: 'Info',
    yes: 'Yes',
    no: 'No',
    ok: 'OK',
    confirm: 'Confirm',
    back: 'Back',
    next: 'Next',
    refresh: 'Refresh',
    reset: 'Reset',
    apply: 'Apply',
    clear: 'Clear',
    select: 'Select',
    selectAll: 'Select All',
    none: 'None',
    all: 'All',
    name: 'Name',
    description: 'Description',
    type: 'Type',
    size: 'Size',
    date: 'Date',
    status: 'Status',
    actions: 'Actions',
    settings: 'Settings',
    preferences: 'Preferences',
    help: 'Help',
    about: 'About',
    version: 'Version',
    file: 'File',
    folder: 'Folder',
    files: 'Files',
    folders: 'Folders',
    open: 'Open',
    connect: 'Connect',
    connecting: 'Connecting...',
    default: 'Default',
    or: 'or',
    optional: 'optional',
  },

  // Welcome/Auth Screen
  welcome: {
    title: 'BluePLM',
    tagline: 'Open-source Product Lifecycle Management',
    selectAccountType: 'Select your account type',
    teamMember: 'Team Member',
    teamMemberDesc: 'Engineers, admins, and viewers',
    supplier: 'Supplier',
    supplierDesc: 'Vendor portal access',
    workOffline: 'Work Offline',
    offlineMode: 'Offline Mode',

    // Team member auth
    teamSignIn: 'Team Member Sign In',
    signInWithOrg: 'Sign in with your organization account',
    signInWithGoogle: 'Sign In with Google',
    tryAgain: 'Try Again',
    connecting: 'Connecting...',
    roleSetByOrg: 'Your role (Admin, Engineer, Viewer) is set by your organization',

    // Supplier auth
    supplierPortal: 'Supplier Portal',
    createAccount: 'Create your supplier account',
    signInToAccount: 'Sign in to your account',
    email: 'Email',
    password: 'Password',
    confirmPassword: 'Confirm Password',
    passwordMismatch: 'Passwords do not match',
    phone: 'Phone',
    phoneNumber: 'Phone Number',
    fullName: 'Full Name',
    createAccountBtn: 'Create Account',
    signIn: 'Sign In',
    alreadyHaveAccount: 'Already have an account? Sign in',
    noAccount: "Don't have an account? Create one",
    useEmailPassword: 'Use Email & Password',
    useGoogleInstead: 'Or sign in with Google',
    sendVerificationCode: 'Send Verification Code',
    verificationCode: 'Verification Code',
    verifyAndSignIn: 'Verify & Sign In',
    useDifferentNumber: 'Use a different number',
    verificationSent: 'A verification code was sent to',
    includeCountryCode: 'Include country code (e.g., +86 for China, +1 for US)',
    supplierInviteNote:
      'Suppliers are invited by organizations. Contact your buyer if you need access.',

    // Vault connection
    connectingToOrg: 'Connecting to your organization...',
    organizationVaults: 'Organization Vaults',
    noVaultsCreated: 'No Vaults Created',
    noVaultsAdminMsg: 'Create a vault in Settings → Organization to get started.',
    noVaultsUserMsg: 'Ask an organization admin to grant you access to a vault.',
    advancedOptions: 'Or use the advanced options below to connect manually.',
    localVault: 'Local Vault',

    madeWith: 'Made with 💙 by Blue Robotics',
  },

  // Setup Screen
  setup: {
    welcome: 'Welcome to BluePLM',
    connectToBackend: "Connect to your organization's Supabase backend to get started",
    imAdmin: 'Set Up an Organization',
    imAdminDesc: 'Connect BluePLM to your Supabase backend and get a code to share with your team.',
    haveCode: 'Join an Organization',
    haveCodeDesc: 'Already have a code from your admin? Enter it to connect.',
    needHelp: 'Need help setting up Supabase?',

    // Admin setup
    adminSetup: 'Admin Setup',
    enterCredentials: "Enter your Supabase credentials from your project's API settings",
    projectId: 'Project ID',
    projectIdHelp: 'Found at the top of your Supabase Dashboard (e.g., vvyhpdzqdizvorrhjhvq)',
    anonKey: 'Anon (Public) Key',
    orgSlug: 'Organization Slug',
    orgSlugHelp: 'This helps identify your organization in the generated code',
    connectToSupabase: 'Connect to Supabase',
    findInDashboard: 'Find these values in your Supabase Dashboard → Project Settings → API',

    // Success
    connectedSuccess: 'Connected Successfully!',
    shareCode: 'Share this code with your team members so they can connect',
    organizationCode: 'Organization Code',
    keepCodeSecure:
      'Team members can paste this code when they first open BluePLM. Keep this code secure - it contains your Supabase credentials.',
    continueToBluePLM: 'Continue to BluePLM',

    // Member setup
    joinOrg: 'Join Your Organization',
    enterCode: 'Enter the code provided by your organization admin',

    // Errors
    enterBothFields: 'Please enter both Project ID and Anon Key',
    invalidProjectId: 'Please enter a valid Project ID (letters and numbers only)',
    failedToConnect: 'Failed to connect to Supabase',
    enterOrgCode: 'Please enter the Organization Code',
    invalidCode: 'Invalid Organization Code. Please check and try again.',
    failedWithCode: 'Failed to connect to Supabase with provided code',
  },

  // Drawing references shown when a .slddrw row is expanded
  drawingRefs: {
    unresolved: 'References could not be read',
    retry: 'Retry',
    retryHint: 'Read again, opening the drawing in SolidWorks if needed',
    retryFailed: 'Still could not read this drawing’s references',
  },

  // Settings
  settings: {
    title: 'Settings',
    preferences: 'Preferences',
    account: 'Account',
    vault: 'Vault',
    organization: 'Organization',
    integrations: 'Integrations',
    solidworks: 'SolidWorks',
    backup: 'Backup',
    api: 'API',
    logs: 'Logs',
    about: 'About',
  },

  // Log viewer
  logs: {
    loadFailed: 'Unable to load log files',
    directoryPath: 'Logs directory: {{path}}',
    directoryUnavailable: 'Logs directory path unavailable',
  },

  // Preferences
  preferences: {
    title: 'Preferences',
    applicationUpdates: 'Application Updates',
    checkForUpdates: 'Check for Updates',
    checking: 'Checking...',
    upToDate: 'Up to date',
    available: 'Available',
    youHaveLatest: 'You have the latest version',
    updateAvailable: 'Update available! Check the notification.',
    couldNotCheck: 'Could not check for updates',
    checkForNewVersions: 'Check for new versions',

    appearance: 'Appearance',
    themeDark: 'Dark',
    themeDarkDesc: 'VS Code Dark+ style',
    themeDeepBlue: 'Deep Blue',
    themeDeepBlueDesc: 'Ocean blue theme',
    themeLight: 'Light',
    themeLightDesc: 'VS Code Light+ style',
    themeChristmas: '🎄 Christmas',
    themeChristmasDesc: 'Festive with snow, sleighs & bells!',
    themeHalloween: '🎃 Halloween',
    themeHalloweenDesc: 'Spooky with bonfire sparks, ghosts & pumpkins!',
    themeKenneth: '👑 Kenneth',
    themeKennethDesc: 'Royal purple elegance',
    themeWeather: '🌤️ Local Weather',
    themeWeatherDesc: 'Dynamic theme that adapts to your local weather!',
    themeSystem: 'System',
    themeSystemDesc: 'Follow OS preference',
    autoSeasonalThemes: 'Auto-apply seasonal themes',
    autoSeasonalThemesDesc:
      'Automatically switch to Halloween (Oct 1) and Christmas (Dec 1) themes',

    language: 'Language',
    displayLanguage: 'Display Language',
    chooseLanguage: 'Choose the language for the interface',
    translationsNote: 'Note: Some translations may be incomplete. Restart may be required.',

    fileExtensions: 'File Extensions',
    lowercaseExtensions: 'Lowercase Extensions on Upload',
    lowercaseExtensionsDesc: 'Convert .SLDPRT to .sldprt when checking in files',

    ignorePatterns: 'Ignore Patterns (Keep Local Only)',
    ignorePatternsDesc: 'Files matching these patterns will stay local and not sync to cloud.',
    ignorePlaceholder: 'e.g., *.tmp, .git/*, thumbs.db',
    connectVaultForPatterns: 'Connect to a vault to manage ignore patterns.',
    noIgnorePatterns: 'No ignore patterns configured',

    syncSettings: 'Sync Settings',
    autoDownloadCloudFiles: 'Auto-download cloud files',
    autoDownloadCloudFilesDesc: 'Automatically download files that exist on server but not locally',
    autoDownloadUpdates: 'Auto-download file updates',
    autoDownloadUpdatesDesc: 'Automatically download when server has newer versions',
    autoDownloadSizeLimit: 'Skip large files',
    autoDownloadSizeLimitDesc: 'Avoid auto-downloading files larger than a specified size',
    maxFileSize: 'Max file size:',
    excludedFiles: 'Excluded files',
    excludedFilesDesc: '{{count}} file(s) excluded from auto-download (manually removed)',
    clearExcludedFiles: 'Clear list',
    autoDiscardOrphanedFiles: 'Auto-discard orphaned files',
    autoDiscardOrphanedFilesDesc:
      'Automatically remove local files that no longer exist on the server',
    discardOrphaned: 'Discard Orphaned',
    discardOrphanedCount: 'Discard Orphaned ({{count}} file{{plural}})',
    orphanedFilesDescription:
      'These files were previously synced but have been deleted from the server by another user',
  },

  // Activity bar / Sidebar
  sidebar: {
    // Source Files
    explorer: 'Explorer',
    pending: 'Pending',
    history: 'History',
    workflows: 'File Workflows',
    reviews: 'Reviews',
    trash: 'Trash',
    // Products
    products: 'Product Explorer',
    items: 'Item Browser',
    // Change Control
    ecr: 'ECRs / Issues',
    eco: 'ECOs',
    notifications: 'Notifications',
    deviations: 'Deviations',
    releaseSchedule: 'Release Schedule',
    process: 'Process Editor',
    // Supply Chain - Suppliers
    supplierDatabase: 'Supplier Database',
    supplierPortal: 'Supplier Portal',
    // Customers
    customers: 'Customers',
    // Integrations
    googleDrive: 'Google Drive',
    // System
    terminal: 'Terminal',
    settings: 'Settings',
    // Section Headers
    sourceFiles: 'Source Files',
    itemsSection: 'Items',
    changeControl: 'Change Control',
    supplyChain: 'Supply Chain',
    suppliers: 'Suppliers',
    purchasing: 'Purchasing',
    logistics: 'Logistics',
    production: 'Production',
    quality: 'Quality',
    integrations: 'Integrations',
    // Sidebar control
    sidebarControl: 'Sidebar control',
    expanded: 'Expanded',
    collapsed: 'Collapsed',
    expandOnHover: 'Expand on hover',
  },

  // File browser
  fileBrowser: {
    name: 'Name',
    fileStatus: 'File Status',
    checkedOutBy: 'Checked Out By',
    version: 'Ver',
    itemNumber: 'Item Number',
    tabNumber: 'Tab',
    description: 'Description',
    revision: 'Rev',
    state: 'State',
    ecoTags: 'ECOs',
    extension: 'Type',
    size: 'Size',
    modified: 'Modified',
    noFilesFound: 'No files found',
    dropFilesHere: 'Drop files here to upload',
  },

  // File operations
  fileOps: {
    checkIn: 'Check In',
    checkOut: 'Check Out',
    download: 'Download',
    upload: 'Upload',
    delete: 'Delete',
    rename: 'Rename',
    move: 'Move',
    copy: 'Copy',
    paste: 'Paste',
    openFile: 'Open File',
    openFolder: 'Open Folder',
    openInExplorer: 'Open in Explorer',
    viewHistory: 'View History',
    compare: 'Compare',
    rollback: 'Rollback',
    discard: 'Discard Changes',
    forceRelease: 'Force Release',
  },

  // Sharing a file by link. Every one of these is a refusal: the success path returns a URL rather
  // than a sentence. `notPermitted` covers both halves of its clause on purpose - the database
  // answers "may this person share it" and "was the share recorded" with the same refusal, and
  // guessing which one it meant would put a wrong reason in front of the user.
  shareLink: {
    fileNotFound: 'File not found',
    noContent: 'File has no content in storage',
    notPermitted:
      'You do not have permission to share this file, or the share could not be recorded. No link was created.',
    signingFailed: 'Failed to generate download URL',
  },

  // Status messages
  status: {
    ready: 'Ready',
    syncing: 'Syncing...',
    uploading: 'Uploading...',
    downloading: 'Downloading...',
    processing: 'Processing...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    offline: 'Offline',
    online: 'Online',
  },

  // File states
  fileState: {
    released: 'Released',
    inWork: 'In Work',
    pending: 'Pending',
    obsolete: 'Obsolete',
    checkedOut: 'Checked Out',
    checkedIn: 'Checked In',
  },

  // Diff status
  diffStatus: {
    added: 'Added',
    modified: 'Modified',
    deleted: 'Deleted',
    outdated: 'Outdated',
    cloud: 'Cloud',
    cloudNew: 'New (Cloud)',
    moved: 'Moved',
    ignored: 'Ignored',
  },

  // Vault Setup Dialog
  vaultSetup: {
    title: 'Set Up Your Vault',
    subtitle: 'Configure how files are synced to your computer',
    fileCount: '{{count}} files',
    fileCountSingular: '1 file',
    totalSize: '{{size}} total',
    autoDownloadCloudTitle: 'Auto-download cloud files',
    autoDownloadCloudDesc:
      'Automatically download files that exist on the server but not on your computer',
    autoDownloadUpdatesTitle: 'Auto-download file updates',
    autoDownloadUpdatesDesc:
      'Automatically download newer versions when files are updated on the server',
    sizeLimitTitle: 'Skip large files',
    sizeLimitDesc: 'Avoid auto-downloading files larger than a specified size',
    maxFileSize: 'Max file size:',
    summary: 'After connecting, BluePLM will download {{count}} files ({{size}})',
    summaryNoDownload: 'Files will only be downloaded when you request them',
    connect: 'Connect Vault',
    skip: 'Skip Setup',
  },

  // Upload size warning dialog
  uploadWarning: {
    title: 'Large Files Detected',
    subtitle: '{{count}} file(s) exceed {{threshold}} MB',
    description:
      "You're about to upload {{count}} file(s) larger than your {{threshold}} MB threshold ({{size}} total).",
    smallFilesNote: '{{count}} other file(s) will upload normally.',
    largeFilesLabel: 'Large files:',
    cancel: 'Cancel',
    skipLarge: 'Skip Large Files',
    uploadAll: 'Upload All',
  },

  // Source / Details Panel
  source: {
    configTree: {
      drawings: 'Drawings',
      ebom: 'eBOM',
      noDrawings: 'No drawings reference this configuration',
      noComponents: 'No components in this configuration',
      expand: 'Expand',
      collapse: 'Collapse',
    },
    configCommit: {
      write: 'Write to file',
      writeAndSync: 'Write and update drawings',
      writeAndSyncCount: 'Write and update drawings for {{count}} configurations',
      pending: 'Not yet written to the document',
      swOffline: 'Start the SolidWorks service to write configuration metadata',
      summary:
        'Configurations written: {{configurations}}; drawings updated: {{updated}}, skipped: {{skipped}}, failed: {{failed}}',
    },
    configDrawings: {
      dialogTitle: 'Drawings reference this configuration',
      dialogBody:
        'Some referenced drawings are not checked out by you. They must be checked out before they can receive the update.',
      checkOutAndUpdate: 'Check out and update',
      forceModelOnly: 'Write model only',
      heldBy: 'Held by {{name}}',
      blocked: 'Held by others',
      notInVault: 'Not in this vault',
      ready: 'Ready to update',
      available: 'Available to check out',
      modelOnlyWarning:
        'Write model only leaves drawings that are not checked out by you unchanged.',
    },
    inspection: {
      title: 'Inspection Table',
      notSynced: 'Sync this drawing to bluePLM to manage its inspection table.',
      notInstalledTitle: 'Inspection tables not set up',
      notInstalledBody:
        'Your database does not have the inspection module yet. Ask your admin to run the latest schema (modules/15-inspection.sql) to enable inspection tables.',
      version: 'Version',
      current: 'Current',
      saving: 'Saving…',
      readOnlyCheckout: 'Check out the drawing to edit',
      addRow: 'Add Row',
      deleteRow: 'Delete row',
      sortBy: 'Click to sort',
      filterAll: 'All',
      filterPlaceholder: 'Filter…',
      noMatches: 'No rows match the current filters.',
      methods: 'Methods',
      manageMethods: 'Manage methods…',
      generateTemplate: 'Generate template',
      generating: 'Generating…',
      templateLoading: 'Loading templates…',
      templateNone: 'No templates found in the configured folder.',
      templateConnectDrive: 'Connect Google Drive to generate inspection templates.',
      templateListFailed: 'Failed to load templates from Google Drive.',
      templateSuccess: 'Inspection sheet generated. Opening in Google Sheets…',
      templateFailed: 'Failed to generate the inspection sheet.',
      methodsTitle: 'Inspection Methods',
      addMethodPlaceholder: 'New method name',
      addMethodButton: 'Add',
      noMethods: 'No methods yet. Add one above.',
      builtIn: 'Built-in',
      empty: 'No inspection characteristics yet.',
      importFromSw: 'Pull from SOLIDWORKS',
      importing: 'Pulling…',
      importServiceOffline: 'Start the SOLIDWORKS service to import inspection characteristics.',
      importNotDrawing: 'Open a SOLIDWORKS drawing (.slddrw) to import inspection characteristics.',
      importAddinUnavailable:
        'SOLIDWORKS Inspection add-in not available. Install it, ensure it is licensed, and enable it in Tools > Add-Ins.',
      importNone: 'No SOLIDWORKS Inspection characteristics found in this drawing.',
      importSuccess: 'Imported {count} characteristic(s) from SOLIDWORKS',
      importFailed: 'Failed to import from SOLIDWORKS',
      importConfirmReplace:
        'This will replace the current inspection rows with the characteristics from SOLIDWORKS. Continue?',
      pushToSw: 'Push to SOLIDWORKS',
      pushing: 'Pushing…',
      pushConfirm:
        'This will write inspection metadata (criticality, method, operation, AQL, comments) for {count} changed characteristic(s) back into the SOLIDWORKS drawing and save it. Continue?',
      pushSuccess: 'Pushed metadata to {matched} characteristic(s) and saved the drawing',
      pushSavedWarn:
        'Pushed metadata to {matched} characteristic(s), but the drawing could not be saved automatically — save it in SOLIDWORKS.',
      pushNoneMatched:
        'No matching characteristics found in the SOLIDWORKS drawing (matched by balloon number).',
      pushNoChanges: 'No unpushed changes to send to SOLIDWORKS.',
      pushFailed: 'Failed to push to SOLIDWORKS',
      unpushedBadge: '{count} unpushed',
      unpushedTitle:
        '{count} characteristic(s) have metadata changes not yet pushed to the SOLIDWORKS drawing.',
      unpushedWarnLeave:
        'You have inspection changes that have not been pushed to the SOLIDWORKS drawing. Leave anyway?',
    },
    // Writing datacard edits into the SolidWorks file. A write that does not reach the file keeps
    // the user's value and marks it, so these messages say where the value stands rather than
    // announcing that it was thrown away.
    metadataWrite: {
      failed: 'Your edit is saved here but is not in the file yet — retry to write it',
      serviceOffline:
        'Your edit is saved here. Start the SolidWorks service to write it into the file',
      partial: 'Wrote {{saved}} of {{total}} — the rest is kept here and marked as not in the file',
      unverified: 'Written, but the file could not be read back to confirm it',
      saved: 'Saved metadata to file',
      runSyncMetadata: 'Run Sync Metadata to write it into the file',
      // What the marker on an edited field means, one message per write state.
      statePending: 'Not written to the file yet',
      stateWriting: 'Writing to the file…',
      stateVerified: 'Confirmed in the file',
      stateUnverified: 'Written, but not confirmed in the file',
      stateFailed: 'Not in the file — the write was refused',
      stateUnattempted: 'Not in the file — the SolidWorks service was unavailable',
      promotedUnverified:
        'This value is in the database but was never confirmed in the file — the file may still hold the old one',
      affectedConfigurations: 'Configurations affected: {{names}}',
    },
    details: {
      dragToReorder: 'Drag to reorder or move to right panel',
      selectFileToView: 'Select a file to view details',
      filesSelected: 'files selected',
      selectFileToPreview: 'Select a file to preview',
      calculating: 'Calculating...',
      location: 'Location',
      revision: 'Revision',
      editable: 'Editable',
      locked: 'Locked',
      checkedOut: 'Checked Out',
      someone: 'Someone',
      notCheckedOut: 'Not checked out',
      syncStatus: 'Sync Status',
      synced: 'Synced',
      localOnlyIgnored: 'Local only (ignored)',
      localOnly: 'Local only',
      openInEDrawings: 'Open in eDrawings',
      externalViewerNote: 'Using external viewer (change in Settings → Preferences)',
      eDrawingsNotFound: 'eDrawings Not Found',
      installEDrawings: 'Install the free eDrawings viewer to preview SolidWorks files.',
      downloadEDrawings: 'Download eDrawings (Free)',
      zoomOut: 'Zoom out',
      zoomIn: 'Zoom in',
      resetToFit: 'Reset to fit',
      openInFullEDrawings: 'Open in full eDrawings for 3D interaction',
      eDrawingsLabel: 'eDrawings',
      noEmbeddedPreview: 'No embedded preview available',
      noPreviewAvailable: 'No Preview Available',
      noPreview: 'No preview available',
      unknown: 'Unknown',
      cannotPreview: 'files cannot be previewed',
      openWithDefaultApp: 'Open with Default App',
      generateSerial: 'Generate next serial number',
      clickToEdit: 'Click to edit',
      checkOutToEdit: 'Check out file to edit',
    },
    pdfViewer: {
      widthLabel: 'Width',
      fitLabel: 'Fit',
      disableAreaSelection: 'Disable area selection (Alt+Drag)',
      enableAreaSelection: 'Enable area selection',
      toggleAreaSelection: 'Toggle area selection',
      zoomOutTitle: 'Zoom out (Ctrl+-)',
      zoomOut: 'Zoom out',
      zoomInTitle: 'Zoom in (Ctrl++)',
      zoomIn: 'Zoom in',
      fitToWidth: 'Fit to width',
      fitToPage: 'Fit to page',
      failedToReadPdf: 'Failed to read PDF file from disk.',
      loadingPdf: 'Loading PDF...',
      failedToLoadPdf: 'Failed to load PDF',
      openExternally: 'Open Externally',
    },
    vendors: {
      pleaseEnterVendorName: 'Please enter a vendor name',
      vendorCreated: 'Vendor created',
      pleaseSelectVendor: 'Please select a vendor',
      vendorAdded: 'Vendor added',
      vendorUpdated: 'Vendor updated',
      preferredVendorUpdated: 'Preferred vendor updated',
      vendorRemoved: 'Vendor removed',
      fileNotSynced: 'File Not Synced',
      syncToManageVendors: 'Sync this file to the cloud to manage vendors',
      addVendor: 'Add Vendor',
      noVendorsAssigned: 'No vendors assigned',
      selectVendor: 'Select Vendor',
      changeVendor: 'Change vendor',
      searchOrSelectVendor: 'Search or select vendor...',
      createNewVendor: 'Create new vendor',
      noVendorsFound: 'No vendors found',
      noAvailableVendors: 'No available vendors',
      newVendor: 'New Vendor',
      vendorName: 'Vendor name',
      create: 'Create',
      clickAddVendorHint: 'Click "Add Vendor" to assign vendors to this part',
      costBreaks: 'Cost Breaks',
      qty: 'Qty',
      price: 'Price',
      addFirstPriceBreak: 'Add your first price break (e.g., @ 1+ → $10.00)',
      addMoreQuantityTiers: 'Add more quantity tiers for volume discounts',
      vendorPartNumber: 'Vendor P/N',
      vendorPartNumberPlaceholder: 'e.g. ABC-123',
      minQty: 'Min Qty',
      leadTime: 'Lead Time',
      days: 'days',
      descriptionPlaceholder: 'Description for this part',
      partLink: 'Part Link',
      urlPlaceholder: 'https://...',
      notes: 'Notes',
      notesPlaceholder: 'Internal notes...',
      unknown: 'Unknown',
      preferredVendor: 'Preferred vendor',
      setAsPreferred: 'Set as preferred',
      vendorPartNumberLabel: 'Vendor P/N:',
      leadLabel: 'Lead:',
      moqLabel: 'MOQ:',
      link: 'Link',
    },
  },

  // Pending view
  pending: {
    unknownUser: 'Unknown',
    showInExplorer: 'Show in Explorer',
    unsavedChanges: 'Unsaved changes',
    modified: 'Modified',
    focusInSolidWorks: 'Focus in SolidWorks',
    virtualComponent: 'Virtual component',
    virtual: 'Virtual',
    collapse: 'Collapse',
    expandComponents: 'Expand components',
    noOpenComponents: 'No open components',
    anotherComputer: 'another computer',
    selectedItems: 'Selected Items',
    openFiles: 'Open Files',
    refreshActiveFiles: 'Refresh active files',
    refresh: 'Refresh',
    swCannotCommunicate: "SolidWorks is running but BluePLM can't communicate with it.",
    reconnecting: 'Reconnecting...',
    reconnect: 'Reconnect',
    reconnectHint:
      "If reconnecting doesn't work, save your work in SolidWorks first, then restart it.",
    noActiveFiles: 'No active files',
    newFiles: 'New Files',
    deselectAll: 'Deselect All',
    selectAll: 'Select All',
    noNewFiles: 'No new files',
    newFilesHint: "These files exist locally but haven't been synced to the cloud yet.",
    checkedOutFiles: 'Checked Out Files',
    discard: 'Discard',
    noFilesCheckedOut: 'No files checked out',
    checkedOutByOthers: 'Checked Out by Others',
    forceReleaseTooltip:
      "Immediately release the checkout. User's unsaved changes will be orphaned.",
    adminForceReleaseHint: 'Admin: Select files to force release checkout',
    deletedFromServer: 'Deleted from Server',
    reuploadTooltip: 'Re-upload these files to the server as new files',
    reupload: 'Re-upload',
    deleteOrphanedTooltip: 'Delete these orphaned local files',
    deleteLocal: 'Delete Local',
    deletedFromServerHint:
      'Another user deleted these files from the server. Your local copies are orphaned.',
    totalSyncedFiles: 'Total synced files:',
    totalCheckedOut: 'Total checked out:',
    newFilesToSync: 'New files to sync:',
    deletedFromServerLabel: 'Deleted from server:',
    deleteFiles: 'Delete Files',
    deleteRecycleBinHint: 'This will move the files to your Recycle Bin.',
    checkInFromDifferentComputer: 'Check In From Different Computer',
    cannotCheckInMachineOffline: 'Cannot Check In - Machine Offline',
    checkInFromOriginalHint:
      'This ensures no unsaved work is lost. Please check in from the original computer, or wait for it to come online.',
    forceCheckIn: 'Force Check In',
    ok: 'OK',
  },

  // Trash view
  trash: {
    deleteNotPermitted:
      'You do not have permission to delete files. Ask an administrator for the Delete permission on Explorer.',
    openVaultToView: 'Open a vault to view trash',
    signInToView: 'Sign in to view trash',
    fileViewTitle: 'File view - show only deleted files',
    folderViewTitle: 'Folder view - show only deleted folders',
    nestedViewTitle: 'Nested view - show files in folder hierarchy',
    filters: 'Filters',
    refresh: 'Refresh',
    searchPlaceholder: 'Search deleted files...',
    deletedBy: 'Deleted by',
    allUsers: 'All users',
    folder: 'Folder',
    allFolders: 'All folders',
    vault: 'Vault',
    allVaults: 'All vaults',
    clearAllFilters: 'Clear all filters',
    showAllDeletedFiles: 'Show all deleted files',
    selectAll: 'Select All',
    clear: 'Clear',
    restore: 'Restore',
    trashIsEmpty: 'Trash is empty',
    deletedFilesAppearHere: 'Deleted files appear here',
    noMatchingFiles: 'No matching files',
    tryAdjustingSearch: 'Try adjusting your search or filters',
    clearFilters: 'Clear filters',
    noDeletedFiles: 'No deleted files',
    onlyFoldersInTrash: 'Only folders are in the trash',
    noDeletedFolders: 'No deleted folders',
    onlyRootLevelFiles: 'Only root-level files are in the trash',
    noDeletedFilesToOrganize: 'No deleted files to organize',
    filesAppearInHierarchy: 'Files will appear in their folder hierarchy',
    emptyTrash: 'Empty Trash',
    autoDeleteNotice: 'Files are automatically deleted after 30 days',
    warning: 'Warning:',
    emptyTrashWarningMessage:
      'This action cannot be undone. All files in the trash will be permanently deleted.',
    emptying: 'Emptying...',
  },

  // Reviews dashboard
  reviews: {
    gates: {
      title: 'Workflow gates',
      subtitle: 'Approvals blocking a state change',
      empty: 'No gate approvals are waiting on you',
      approve: 'Approve',
      reject: 'Reject',
      kickBack: 'Kick back',
      approved: 'Approval recorded',
      rejected: 'Decision recorded',
      advanced: 'Approved; the file moved to {{state}}',
      failed: 'Could not record the decision',
      requestedBy: 'Requested by {{email}}',
    },
    myReviews: 'My Reviews',
    allReviews: 'All Reviews',
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    overdue: 'Overdue',
    noMatchingReviews: 'No matching reviews',
    noReviewsFound: 'No reviews found',
    tryAdjustingFilters: 'Try adjusting your filters or search query',
    rightClickToRequestReview: 'Right-click a file in the Explorer to request a review',
    loadingReviews: 'Loading reviews...',
    failedToLoadReviews: 'Failed to load reviews',
    retry: 'Retry',
    signInToViewReviews: 'Sign in to view reviews',
    connectToOrgToSeeReviews: 'Connect to your organization to see file review status',
    refreshReviews: 'Refresh reviews',
    allTeams: 'All Teams',
    configureVisibleTeams: 'Configure visible teams',
    visibleTeams: 'Visible Teams',
    searchPlaceholder: 'Search by file name, title, or user...',
  },

  // Workflows
  workflows: {
    layoutSaveFailed: 'Could not save the diagram layout',
    transition: {
      moved: 'Moved to {{state}}',
      failed: 'Failed to change state',
      reviewRequested: 'Review requested; the file moves once the gates are approved',
      awaitingReview: 'This transition is waiting on a review',
    },
    import: {
      unreadableFile: 'That file is not valid JSON',
      notAWorkflowFile: 'That file is not a workflow export',
      noStates: 'The file contains no states to import',
      badState: 'The file has a malformed or duplicated state',
      badTransition: 'The file has a transition pointing at a missing state',
      title: 'Import workflow',
      question: 'Import workflow from {{file}}?',
      warning:
        'This replaces everything in {{workflow}} with {{states}} states, {{transitions}} transitions and {{gates}} gates.',
      confirm: 'Import',
      importing: 'Importing...',
    },
    emptyCanvas: 'Select a workflow to edit',
    history: {
      undoStateAdd: 'Undo: state removed',
      undoStateDelete: 'Undo: state restored',
      undoStateMove: 'Undo: state moved back',
      undoTransitionAdd: 'Undo: transition removed',
      undoTransitionDelete: 'Undo: transition restored',
      undoFailed: 'Undo failed',
      redoStateAdd: 'Redo: state added',
      redoStateDelete: 'Redo: state deleted',
      redoStateMove: 'Redo: state moved',
      redoTransitionAdd: 'Redo: transition added',
      redoTransitionDelete: 'Redo: transition deleted',
      redoFailed: 'Redo failed',
    },
    toolbar: {
      selectWorkflow: 'Select workflow',
      selectWorkflowPlaceholder: 'Select workflow...',
      defaultSuffix: '(default)',
      createNewWorkflow: 'Create new workflow',
      editWorkflow: 'Edit workflow name & description',
      selectMode: 'Select mode (Esc)',
      panMode: 'Pan mode',
      connectMode: 'Connect mode - draw transitions',
      cancelEsc: 'Cancel (Esc)',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      centerOnContent: 'Center on content',
      resetZoom: '1:1',
      snapSettings: 'Snap settings',
      snapSettingsHeading: 'Snap Settings',
      snapToGrid: 'Snap to Grid',
      snapToAlignment: 'Snap to Alignment',
      exportWorkflow: 'Export workflow to JSON',
      importWorkflow: 'Import workflow from JSON',
      manageRoles: 'Manage workflow roles (approval authorities)',
      roles: 'Roles',
      addState: 'Add State',
    },
    stateToolbar: {
      fillColor: 'Fill color',
      fillColorLabel: 'Fill Color',
      boxStyling: 'Box styling',
      noFill: 'No fill',
      fillOpacity: 'Fill Opacity',
      borderColor: 'Border Color',
      sameAsFill: 'Same as fill',
      borderOpacity: 'Border Opacity',
      borderThickness: 'Border Thickness',
      cornerRadius: 'Corner Radius',
      shape: 'Shape',
      rectangle: 'Rectangle',
      diamond: 'Diamond (for approval gates)',
      hexagon: 'Hexagon',
      ellipse: 'Ellipse',
      editState: 'Edit state',
      duplicate: 'Duplicate',
      deleteState: 'Delete state',
    },
    transitionToolbar: {
      lineColor: 'Line color',
      linePathType: 'Line path type',
      pathStraight: 'Straight',
      pathSpline: 'Spline',
      pathElbow: 'Elbow',
      lineSettings: 'Line settings',
      thickness: 'Thickness',
      style: 'Style',
      styleSolid: 'Solid',
      styleDashed: 'Dashed',
      styleDotted: 'Dotted',
      arrowDirection: 'Arrow direction',
      arrow: 'Arrow',
      arrowAtEnd: 'Arrow at end',
      arrowAtStart: 'Arrow at start',
      arrowsAtBothEnds: 'Arrows at both ends',
      noArrows: 'No arrows',
      editTransition: 'Edit transition',
      deleteTransition: 'Delete transition',
    },
  },

  // RFQ (Request for Quotation)
  rfq: {
    newRfq: 'New RFQ',
    searchRfqs: 'Search RFQs...',
    total: 'Total',
    pending: 'Pending',
    quoted: 'Quoted',
    noRfqsFound: 'No RFQs found',
    due: 'Due',
    itemsLabel: 'items',
    suppliersLabel: 'suppliers',
    backToRfqs: 'Back to RFQs',
    itemsTab: 'Items',
    suppliersTab: 'Suppliers',
    settings: 'Settings',
    dropFilesHere: 'Drop files here to add',
    dragFilesHere: 'Drag files here',
    or: 'or',
    browseFiles: 'browse files',
    dragFromFileBrowser: 'Drag from the file browser to add parts',
    selectFilesToAdd: 'Select files to add:',
    noItemsYet: 'No items yet',
    addFilesToGetStarted: 'Add files from your vault to get started',
    rev: 'Rev',
    editDetails: 'Edit details',
    showStepInFolder: 'Show STEP file in folder',
    showPdfInFolder: 'Show PDF file in folder',
    needsExport: 'Needs export',
    stepExportConfiguration: 'STEP Export Configuration',
    loadingConfigurations: 'Loading configurations...',
    defaultConfiguration: 'Default configuration',
    noConfigurationsAvailable:
      'No configurations available (SolidWorks service may not be running)',
    material: 'Material',
    materialPlaceholder: 'e.g., 6061-T6 Aluminum',
    finish: 'Finish',
    finishPlaceholder: 'e.g., Anodized Black',
    toleranceClass: 'Tolerance Class',
    toleranceClassPlaceholder: 'e.g., ISO 2768-mK',
    notes: 'Notes',
    notesPlaceholder: 'Special requirements, instructions...',
    generating: 'Generating...',
    generateStepPdf: 'Generate STEP & PDF Files',
    selectSupplierToAdd: 'Select supplier to add:',
    noMoreSuppliers: 'No more suppliers available',
    searchSuppliers: 'Search suppliers...',
    addSupplier: 'Add Supplier',
    noSuppliersAssigned: 'No suppliers assigned yet',
    addSuppliersToMarkReady: 'Add suppliers to mark RFQ as ready',
    days: 'days',
    awaitingQuote: 'Awaiting quote',
    notSent: 'Not sent',
    removeSupplier: 'Remove supplier',
    billingAddress: 'Billing Address',
    noBillingAddresses: 'No billing addresses. Add in Settings → Company Profile.',
    selectBillingAddress: 'Select billing address...',
    defaultLabel: '(Default)',
    attn: 'ATTN:',
    shippingAddress: 'Shipping Address',
    noShippingAddresses: 'No shipping addresses. Add in Settings → Company Profile.',
    selectShippingAddress: 'Select shipping address...',
    dueDate: 'Due Date',
    requiredDate: 'Required Date',
    notesToSuppliers: 'Notes to Suppliers',
    supplierNotesPlaceholder: 'Special instructions, requirements, etc.',
    requirements: 'Requirements',
    requiresSamples: 'Requires samples',
    requiresFai: 'Requires first article inspection (FAI)',
    requiresQualityReport: 'Requires quality report / CoC',
    generateRfqPdfTitle: 'Generate RFQ PDF document',
    rfqPdf: 'RFQ PDF',
    createZipTitle: 'Create ZIP with RFQ PDF and release files',
    zipPackage: 'ZIP Package',
    sendToSuppliers: 'Send to Suppliers',
    titleRequired: 'Title *',
    titlePlaceholder: 'e.g., CNC Parts for Assembly XYZ',
    descriptionPlaceholder: 'Optional details about this RFQ...',
    createRfq: 'Create RFQ',
  },

  // SOLIDWORKS version selection (picker modal + settings row)
  solidworksVersion: {
    title: 'Choose your SOLIDWORKS version',
    subtitle: 'Several versions are installed on this computer',
    explanation:
      'BluePLM can only connect to one SOLIDWORKS version at a time. Pick the one you actually work in, otherwise BluePLM may report that SOLIDWORKS is unavailable while it is open.',
    windowsDefault: 'Windows default',
    confirm: 'Use this version',
    decideLater: 'Decide later',
    settingTitle: 'SOLIDWORKS Version',
    settingLabel: 'Version to connect to',
    settingDescription: 'Which SOLIDWORKS release BluePLM talks to',
    settingHint:
      'Changing this restarts the SOLIDWORKS service. Pick the version you open your files in.',
    automatic: 'Automatic',
    automaticDescription: 'Use whichever version Windows registered as the default',
  },

  // Read-only divergence scanner (`scan-divergence`)
  divergence: {
    heading: 'Divergence scan - database versus SolidWorks files',
    scanned: '{{compared}} files compared of {{fetched}} rows ({{duration}}s)',
    cancelled: 'The scan was cancelled; the numbers below are partial.',
    notRead: '{{missing}} rows had no local file, {{unreadable}} could not be read.',
    skippedOpenInSolidWorks:
      '{{count}} files were left unread because SOLIDWORKS has them open - reading one through Document Manager can make SOLIDWORKS close it.',
    wipeHeading: '1. Configuration maps the database no longer describes',
    wipeSummary:
      '{{files}} of {{multi}} multi-configuration files record fewer configurations than the file has ({{pct}}). {{entries}} configuration entries are missing in total.',
    wipeExcluded:
      '  {{count}} files with configurations carry no configuration map on the row at all and are left out of the count above - the database never described their configurations, so nothing was lost from one.',
    mapEmptied: 'the map is present and holds nothing',
    unrecoverableHeading: '2. Values held by neither side - UNRECOVERABLE',
    unrecoverableNone: '  None found.',
    unrecoverableSummary:
      '  {{count}} values are absent from the database and absent from the file. These cannot be repaired from anything this scan can see.',
    unrecoverableCaveat:
      '  Counted only where the row carries the reserved configuration map at all, which is evidence the row once described this file - including a map that now holds nothing, which is what a wipe of every configuration leaves behind. A file whose row has no such map is reported as no-evidence instead ({{count}} values of those).',
    recoverableHeading: '3. Values the file still holds - recoverable',
    recoverableSummary:
      '  {{count}} values are missing from the database, present in the file under the key BluePLM itself writes, and on a file the database demonstrably once recorded. Those three together are what makes writing them back a repair rather than a guess.',
    absentFromFileSummary:
      '  {{count}} values run the other way: the database holds them and the file does not. Nothing was lost - the document is behind the record - and the only write that settles one goes database to file.',
    unattributedHeading:
      '4. Values the file holds that the database never recorded - NEEDS A DECISION',
    unattributedNone: '  None found.',
    unattributedSummary:
      '  {{count}} values are in the file and absent from the database, with nothing to show the database ever held them. They are not repairs: adopting one writes a value BluePLM never owned.',
    unattributedReason: {
      neverHeld:
        'the row has no configuration map at all, or the column was never filled in - the value in the file came from somewhere other than BluePLM',
      notOwned:
        'the field belongs to something other than this row - a drawing copies its part number and description from its parent model',
      notTranscribable:
        'the file holds a value, but not under a key BluePLM writes, so there is nothing that can be copied across without guessing what it means',
    },
    disagreeingHeading: '5. Values the two sides disagree about',
    disagreeingSummary: '  {{count}} values differ between the two.',
    fieldHeading: '6. Divergence per field',
    timingHeading: '7. Cost of one read-back cycle',
    integrity:
      'Byte-identity: {{hashed}} files hashed before and after the read, {{breaches}} changed.',
    andMore: '  ...and {{count}} more (see the report file)',
    field: {
      partNumber: 'part number',
      description: 'description',
      revision: 'revision',
      configTab: 'configuration tab',
      configDescription: 'configuration description',
    },
    scope: {
      file: 'file',
      configuration: 'config',
    },
    serviceCommandMissing:
      'The SOLIDWORKS service does not have the "{{action}}" command. Rebuild the service and start it again.',
    starting: 'Scanning read-only. Nothing is written to the vault or the database.',
    startedAsync: 'Scan started: {{id}}',
    running: 'Scan {{id}} is running ({{seconds}}s): {{progress}}',
    finished: 'Scan {{id}} {{state}}.',
    noRun: 'No scan has been run in this session.',
    alreadyRunning: 'A scan is already running. Use "scan-divergence status".',
    nothingToCancel: 'No scan is running.',
    cancelRequested: 'Cancelling after the file in flight.',
    failed: 'Scan failed: {{reason}}',
    artifact: 'Report written to {{path}}',
    artifactFailed: 'The report file could not be written: {{reason}}',
    noOrganization: 'Not signed in to an organization.',
    noVault: 'No vault is connected.',
    timingUsage: 'Usage: scan-divergence timing <relative-path>',
    timingRunning: 'Reading {{path}} {{count}} times...',
    timingResult:
      '{{path}}: {{configs}} configurations, median {{median}}ms (min {{min}}ms, max {{max}}ms) per open-and-read-all-scopes cycle',
    timingFailed: 'Could not read {{path}}: {{reason}}',
  },

  // Writing BluePLM's metadata into a SolidWorks file
  metadataWrite: {
    configurationsFailed:
      'Only part of the file was written: {{failed}} of {{total}} configurations did not take the change',
    // Shown instead of a write, not after one. The alternative BluePLM is declining is spelled out
    // because refusing to write looks like a malfunction unless the reader can see what the other
    // choice would have cost them.
    configurationsUnreadable:
      'Nothing was written: BluePLM could not read this file’s configurations, and writing only the document properties would have left every configuration holding its old values.',
    configurationsUnaddressed:
      '{{count}} of this file’s configurations were never written to and still hold their previous values, even though the document properties were updated.',
    configurationsUnwritten:
      'File-level properties were written, but the configurations were not: {{reason}}',
    fieldsUnwritten:
      'Only part of the file was written: {{failed}} of {{total}} fields did not reach the file',
    stillWriting:
      'A metadata write is still running against this file, so it was not checked in. Try again once it finishes',
    promotedUnconfirmed:
      '{{count}} field(s) were saved to BluePLM but could not be confirmed in the file. The rows are marked; open the file and save again to settle them',
    // A drawing's metadata belongs to the model it references, so BluePLM offers to fetch it
    // rather than to push its own. Named for what the user gets, not for the command behind it.
    drawingSyncFromParent: 'Sync from Parent',
    drawingSyncFromParentTooltip:
      'Read this drawing’s item number and description from the model it references',
    drawingInheritedFieldsSkipped:
      'Fields this drawing inherits from its model are not written — use Sync from Parent for those',
    drawingNothingToWrite:
      'This drawing inherits its metadata from the model it references. Use Sync from Parent to read it in.',
    drawingFieldInherited: 'Inherited from the referenced model — change it on the model instead',
  },

  // Context menu translations
  contextMenu: {
    assembly: {
      title: 'Assembly',
      resolving: 'Resolving references...',
      resolveFailed: 'Failed to resolve assembly',
      noComponents: 'No components found',
      downloadAll: 'Download All',
      downloadReferencedFiles: 'Download Referenced Files',
      checkOutAll: 'Check Out All',
      checkInAll: 'Check In All',
      removeLocalAll: 'Remove Local All',
      packAndGo: 'Pack and Go',
      // Confirmation dialog
      confirmDownloadTitle: 'Download Assembly Files?',
      confirmCheckOutTitle: 'Check Out Assembly Files?',
      confirmCheckInTitle: 'Check In Assembly Files?',
      confirmRemoveLocalTitle: 'Remove Local Copies?',
      confirmPackAndGoTitle: 'Pack and Go',
      confirmMessage: 'This will affect {{count}} file(s) associated with this assembly.',
      // File type labels
      assemblies: 'Assemblies',
      parts: 'Parts',
      drawings: 'Drawings',
    },
  },

  // Admin-only Vault Audit page - presents the read-only divergence scan
  vaultAudit: {
    title: 'Vault Audit',
    description:
      'Compare what BluePLM records against what your SOLIDWORKS files actually contain, then put back the per-configuration entries a check-in erased. Your files are only ever read; nothing is written anywhere until you choose what to write.',
    adminOnly: 'Only administrators can run the vault audit.',
    noVault: 'Connect a vault before running the audit.',
    serviceTooOld:
      'The audit reads files with a command added in SOLIDWORKS service v{{version}}. The service on this computer is older, so a scan would fail on its first file after several minutes of walking the vault. Rebuild the service and start it again.',
    readOnlyNote:
      'Files are opened read-only through the Document Manager library. Documents SOLIDWORKS currently has open are skipped rather than read, so a session in progress is left alone.',

    scope: {
      legend: 'What to scan',
      wholeVault: 'Whole vault',
      wholeVaultHint:
        'Every part and assembly. Around eight thousand documents and roughly three minutes.',
      folder: 'One folder',
      folderHint: 'That folder and everything beneath it.',
      folderPlaceholder: 'e.g. 0 - SHARED\\00 - REGRESSION TESTS',
      configurationRecorded: 'Multi-configuration files',
      configurationRecordedHint:
        'Only files BluePLM already records per-configuration metadata for, which is where a configuration record can have lost something. Six of seven models have a single configuration, so this costs a fraction of a full scan. It cannot see a multi-configuration file BluePLM never recorded — nothing was lost from a record that never existed.',
    },

    scan: 'Run audit',
    rescan: 'Run again',
    cancel: 'Cancel',
    cancelling: 'Cancelling after the file in flight…',
    clear: 'Clear results',
    preparing: 'Asking SOLIDWORKS which documents are open…',
    progressFiles: '{{completed}} of {{total}} files read',

    result: {
      heading: 'Result',
      scanned: '{{files}} files compared in {{seconds}}s',
      cancelledNote: 'Cancelled part-way — these numbers cover only the files that were read.',
      generatedAt: 'Scanned {{time}}',
      noFindings: 'Every value compared agrees. Nothing to act on.',
      // The narrower claim, for a run whose scope left files unopened. "Nothing to act on" is not
      // available then: it would be an all-clear over files nothing looked at.
      noFindingsInCompared:
        'Every value compared agrees. Files that were not compared are listed below.',
      // A run with no evidence must not borrow the language of a run that found none. Both produce
      // an empty findings list, and the earlier wording made an unmatched scope read as an all-clear.
      scopeMatchedNothing:
        'No parts or assemblies matched this scope, so nothing was compared. This is not an all-clear.',
      folderMatchedNothing:
        'No file’s path begins with “{{path}}”. The folder is relative to the vault root, like “0 - SHARED\\00 - REGRESSION TESTS” — the browser’s Copy Path buttons give a full path starting with a drive letter, which never matches.',
      comparedNothing:
        '{{rows}} files matched this scope and none of them could be read, so nothing was compared. See below for why.',
      filesWithFindings: '{{files}} of {{compared}} files have at least one finding',
      multiConfiguration: '{{count}} of them have more than one configuration',
      noEvidence:
        '{{count}} values are absent from both sides on rows that never described the file. That is an absence, not a loss, and it is excluded from the counts above.',
      artifact: 'Full report written to {{path}}',
      notStored:
        'Results are recomputed each time rather than stored. A saved audit stops being true the moment anyone checks a file in, and it does so silently.',
    },

    unread: {
      heading: 'Not read',
      missingOnDisk: '{{count}} have no local copy',
      openInSolidWorks: '{{count}} are open in SOLIDWORKS',
      readFailed: '{{count}} could not be opened',
    },

    // Files the run's scope covered but never opened - distinct from `unread`, which is files it
    // tried to open and could not. Worded as an omission rather than as damage on purpose: the
    // thousands of single-configuration models a narrowed run skips are overwhelmingly fine, and an
    // alarming count over them would be a worse lie than the silence it replaces.
    notCompared: {
      heading: 'Not compared',
      noConfigurationRecord:
        '{{count}} carry no configuration record, so a scan of this scope never opens them',
      beyondLimit: '{{count}} were beyond the run’s limit',
    },

    integrity: {
      verified:
        '{{count}} regression fixtures hashed before and after the read; all byte-identical.',
      changed: '{{count}} files changed while being read. This should never happen.',
    },

    coverage: {
      heading: 'Configuration records',
      description:
        'Whether the per-configuration metadata BluePLM holds still lines up with the configurations in each file. Compared by name — a record with more entries than the file has configurations is not damaged, it is carrying keys for configurations that have since gone.',
      allAligned: 'Every record describes exactly the configurations its file has.',
      undescribed: '{{files}} files have configurations their record does not describe',
      undescribedEntries: '{{count}} configurations undescribed in total',
      emptied: '{{count}} of those records exist and describe nothing at all',
      stale: '{{files}} files carry {{count}} entries for configurations that no longer exist',
      staleNote:
        'Stale entries are clutter left by a rename or a deletion, not a loss. They are listed separately because comparing entry counts instead of names would report those files as damaged.',
      noRecord:
        '{{count}} files with configurations carry no record at all and are excluded from both counts above.',
      columnFile: 'File',
      columnConfigurations: 'Configurations',
      columnUndescribed: 'Undescribed',
      columnStale: 'Stale entries',
      recordEmptied: 'record emptied',
      showAll: 'Show all {{total}} files',
      showFewer: 'Show fewer',
    },

    category: {
      heading: 'Findings',
      lost: 'Nothing to copy either way',
      lostDescription:
        'Lost from both sides. Neither BluePLM nor the file holds these any more, so no write restores them — someone has to author the value again.',
      conflicting: 'Choose which value wins',
      conflictingDescription:
        'Both hold a value and they differ. Whichever you keep overwrites the other, so someone has to decide.',
      recoverable: 'Copy the file’s value into BluePLM',
      recoverableDescription:
        'Missing from BluePLM, still in the file under the key BluePLM itself writes. The file is the surviving copy.',
      absentFromFile: 'Copy BluePLM’s value into the file',
      absentFromFileDescription:
        'BluePLM holds these and the file does not. Nothing was lost — the document is behind the record.',
      unattributed: 'Leave these alone',
      unattributedDescription:
        'The file holds a value BluePLM never owned. Adopting one would invent a record rather than restore it, and erasing it is not BluePLM’s to do.',
      values: '{{count}} values',
      files: '{{count}} files',
    },

    resolution: {
      adoptFileValue: 'Use the file’s value',
      adoptFileValueHint:
        'The file holds the surviving copy. Resolving this writes it into BluePLM and changes no document.',
      pushVaultValue: 'Use BluePLM’s value',
      pushVaultValueHint:
        'BluePLM holds the surviving copy. Resolving this writes it into the document, which needs the file closed and checked out.',
      fileAuthoritative: 'Leave revision to the file',
      fileAuthoritativeHint:
        'The file is the source of truth for revision, so the audit never writes BluePLM’s value into a document that has no revision.',
      chooseASide: 'Pick a side',
      chooseASideHint:
        'Both sides hold a value and neither is automatically right. Whichever you keep overwrites the other.',
      nothingToRestore: 'Nothing to copy',
      nothingToRestoreHint:
        'Neither side holds a value, so there is nothing to write in either direction. The value has to be authored again.',
      fixOnParentModel: 'Fix on the parent model',
      fixOnParentModelHint:
        'A drawing’s part number and description are copies of the model’s. Writing either copy over the other leaves the model — the actual record — untouched.',
      leaveAlone: 'Leave alone',
      leaveAloneHint:
        'BluePLM never owned this value, so writing it into BluePLM would invent a record and clearing it from the file would delete someone else’s data.',
    },

    revisionRule: {
      label: 'Parts and assemblies carry their own revision',
      hint: 'Leave this off if your drawings drive revisions and the model never states one — a model file without a revision is expected and the difference is not a finding. Turning it on shows those comparisons; revision remains driven by the file and the audit never writes BluePLM’s revision into a document. Drawings always own their own revision, and changing this re-reads the scan you already have rather than running a new one.',
      hidden:
        '{{count}} revision comparisons on parts and assemblies are not counted above, because your drawings own revision.',
    },

    blocked: {
      noWriteResolvesIt: 'nothing to write',
      noVaultWriterForField: 'BluePLM cannot write this field from an audit yet',
      entryAlreadyRecorded: 'the record already has an entry here',
      heldByAnotherUser: 'someone else has this file checked out',
      fileNotLoaded: 'the file is not loaded, so BluePLM cannot safely preserve its other metadata',
      heldBy: 'checked out by {{user}}',
    },

    difference: {
      caseOnly: 'differs only in capitalisation',
      whitespaceOnly: 'differs only in spacing',
      caseAndWhitespace: 'differs only in capitalisation and spacing',
    },

    actions: {
      noneAvailable:
        'Nothing in this category can be written from here. The rows above say why for each one.',
    },

    push: {
      wholeFileNote:
        'This runs Sync Metadata, which rebuilds every BluePLM-owned property except file-driven revision in the documents you tick — at file scope and in every configuration — and verifies each write by reading it back. It is per file, not per value, so a ticked row selects the whole document.',
      eligible: '{{eligible}} of {{selected}} selected files can be written now.',
      heldByOthers:
        '{{count}} files in this category are checked out by other people and cannot be ticked. Writing to a document somebody is working in would be overwritten by their check-in, so the audit leaves them alone.',
      notCheckedOut:
        '{{count}} are not checked out to you. Sync Metadata will not touch a file you do not hold; check them out in the file browser and they become writable.',
      notLoaded:
        '{{count}} have no local copy loaded, so there is nothing on disk to write to. Download them first.',
      selectPrompt: 'Tick the files whose documents should take BluePLM’s values.',
      selectedSummary: '{{files}} files selected.',
      apply: 'Write {{count}} files',
      running: 'Writing…',
    },

    conflict: {
      instruction:
        'Each conflict needs an explicit choice. “Use BluePLM” writes the whole document from BluePLM’s metadata; “Use file” copies only the selected file values into BluePLM.',
      useBluePlm: 'Use BluePLM',
      useFile: 'Use file',
      fileSelectPrompt: 'Choose “Use file” on the rows whose values should enter BluePLM.',
      fileSelectedSummary: '{{values}} file values selected.',
      applyFile: 'Use {{count}} file values',
      applying: 'Updating BluePLM…',
      bluePlmSelectPrompt: 'Choose “Use BluePLM” on the files whose documents should be rewritten.',
      bluePlmSelectedSummary: '{{files}} files selected.',
      applyBluePlm: 'Write {{files}} files',
      bluePlmNote:
        'The BluePLM direction is per file, so it rewrites every BluePLM-owned property in each selected document, not only the conflict row you clicked.',
      noUser: 'No signed-in user is available to apply this choice.',
      appliedToast: 'Applied {{values}} file values to BluePLM.',
      updateFailed: 'Metadata update failed',
    },

    findings: {
      heading: 'Values in this category',
      none: 'Nothing in this category.',
      selectPrompt: 'Choose a category above to see the individual values.',
      filterPlaceholder: 'Filter by path, configuration or value',
      showing: 'Showing {{shown}} of {{total}}',
      noMatches: 'No values match that filter.',
      columnFile: 'File',
      columnConfiguration: 'Configuration',
      columnField: 'Field',
      columnDatabase: 'BluePLM',
      columnFile2: 'File',
      columnResolution: 'To resolve',
      directionNote:
        'Unambiguous rows show the write direction with an arrow. “Pick a side” rows have action buttons so you can choose which value wins.',
      selectAll: 'Select all {{count}} {{unit}}',
      selectNone: 'Clear the selection ({{count}})',
      unitFiles: 'files',
      unitValues: 'values',
      rangeHint: 'Shift-click a second box to select the rows between.',
      settled: 'Already written in this session',
      fileScope: 'file',
      empty: '—',
      reveal: 'Show in file browser',
      revealUnavailable: 'This file has no local copy to show.',
    },

    repair: {
      guarantee:
        'This can only add entries your record is missing. Every value BluePLM already holds wins over the one proposed here, including entries added since the scan, and entries for configurations that no longer exist are left alone. That is enforced by the database, not by this screen — the merge puts your record on the winning side, so an overwrite or a deletion cannot be expressed.',
      notInstalled:
        'Your database does not have the repair function yet. It ships in schema 94; ask your admin to apply the latest schema (core.sql, then the modules, then tools/verify-schema.sql) and the repair appears here. The audit above works either way.',
      noOrganization: 'No organization is loaded, so there is nothing to repair against.',

      includeDerived: 'Also reconstruct tabs from each configuration’s Number',
      includeDerivedHint:
        'For configurations where neither BluePLM nor the file holds a tab, take the part after the last dash of the configuration’s Number — what the browser shows. This is a reconstruction, not a recovery: the value was never separately recorded, and it may not match the convention your vault uses. Off by default, and every such row is marked.',

      selectPrompt: 'Tick the entries you want written. Nothing is selected, so nothing will be.',
      selectedSummary:
        '{{entries}} entries across {{files}} files selected, {{derived}} of them reconstructed.',
      apply: 'Write {{count}} entries',
      applying: 'Writing…',
      appliedToast: 'Restored {{entries}} entries across {{files}} files.',

      receiptHeading: '{{entries}} entries restored across {{files}} files.',
      // Three reasons an approved entry did not land, kept apart because only one of them is
      // reassuring. Before the receipt distinguished them, the sentence below was printed over all
      // three, so entries that had been dropped were described as entries that were already safe.
      receiptShortfall:
        '{{count}} of the {{requested}} requested were already there. Your record was ahead of the scan and kept what it had, which is the intended outcome rather than a failure.',
      receiptNoRecord:
        '{{count}} entries had no configuration record on the row to be restored into, so they were not written. Those files never carried one, so nothing was lost from them.',
      receiptRefused:
        '{{count}} files could not be reached — moved, deleted, or no longer carrying a configuration record. Nothing was written to them.',
      receiptEntriesDropped:
        '{{count}} approved entries went with them and were not written anywhere. Re-run the scan to pick those files up again.',
    },

    fields: {
      heading: 'Per field',
      columnField: 'Field',
      columnCompared: 'Compared',
      columnAgrees: 'Agree',
      columnFileEmpty: 'File empty',
      columnDatabaseEmpty: 'BluePLM empty',
      columnDiffer: 'Differ',
    },
  },

  // Admin-only folder visibility (decluttering, not access control)
  hiddenFolders: {
    hideFromNonAdmins: 'Hide from non-admins',
    showToEveryone: 'Show to everyone',
    notAccessControl:
      'Hides this folder from the interface for non-admins. This is not an access restriction, the files stay readable.',
    badgeLabel: 'Hidden from non-admins',
    hidden: 'Folder hidden from non-admins',
    unhidden: 'Folder shown to everyone',
    updateFailed: 'Failed to update folder visibility',
    updateNotPermitted: 'You may not have permission to change folder visibility',
    scanSkipped: 'Skipped {{count}} files in folders hidden from non-admins',
  },
}
