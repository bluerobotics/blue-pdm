import { StateCreator } from 'zustand'
import type { PDMStoreState, OperationsSlice, QueuedOperation, OrphanedCheckout, StagedCheckin, MissingStorageFile } from '../types'

export const createOperationsSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  OperationsSlice
> = (set, get) => ({
  // Initial state - Loading
  isLoading: false,
  isRefreshing: false,
  statusMessage: '',
  filesLoaded: false,
  
  // Initial state - Sync
  syncProgress: {
    isActive: false,
    operation: 'upload',
    current: 0,
    total: 0,
    percent: 0,
    speed: '',
    cancelRequested: false
  },
  
  // Initial state - Queue
  operationQueue: [],
  
  // Initial state - Notifications & Reviews
  unreadNotificationCount: 0,
  pendingReviewCount: 0,
  
  // Initial state - Orphaned checkouts
  orphanedCheckouts: [],
  
  // Initial state - Staged check-ins
  stagedCheckins: [],
  
  // Initial state - Missing storage files
  missingStorageFiles: [],
  
  // Actions - Loading
  setIsLoading: (isLoading) => set({ isLoading }),
  setIsRefreshing: (isRefreshing) => set({ isRefreshing }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
  setFilesLoaded: (filesLoaded) => set({ filesLoaded }),
  
  // Actions - Sync
  setSyncProgress: (progress) => set(state => ({ 
    syncProgress: { ...state.syncProgress, ...progress } 
  })),
  startSync: (total, operation = 'upload') => set({ 
    syncProgress: { isActive: true, operation, current: 0, total, percent: 0, speed: '', cancelRequested: false } 
  }),
  updateSyncProgress: (current, percent, speed) => set(state => ({ 
    syncProgress: { ...state.syncProgress, current, percent, speed } 
  })),
  requestCancelSync: () => set(state => ({ 
    syncProgress: { ...state.syncProgress, cancelRequested: true } 
  })),
  endSync: () => {
    set({ 
      syncProgress: { isActive: false, operation: 'upload', current: 0, total: 0, percent: 0, speed: '', cancelRequested: false } 
    })
    // Process the queue after ending sync so the next operation can start
    setTimeout(() => get().processQueue(), 100)
  },
  
  // Actions - Queue
  queueOperation: (operation) => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const fullOperation: QueuedOperation = { ...operation, id }
    
    set(state => ({
      operationQueue: [...state.operationQueue, fullOperation]
    }))
    
    // Try to process the queue immediately
    setTimeout(() => get().processQueue(), 0)
    
    return id
  },
  
  removeFromQueue: (id) => set(state => ({
    operationQueue: state.operationQueue.filter(op => op.id !== id)
  })),
  
  hasPathConflict: (paths) => {
    const { processingFolders } = get()
    
    // Check if any of the requested paths overlap with currently processing paths
    for (const path of paths) {
      for (const processingPath of processingFolders) {
        // Check if paths overlap (one contains the other or they're the same)
        if (path === processingPath || 
            path.startsWith(processingPath + '/') || 
            path.startsWith(processingPath + '\\') ||
            processingPath.startsWith(path + '/') || 
            processingPath.startsWith(path + '\\')) {
          return true
        }
      }
    }
    return false
  },
  
  processQueue: async () => {
    const { operationQueue, hasPathConflict, removeFromQueue, addToast, syncProgress } = get()
    
    if (operationQueue.length === 0) return
    
    // Don't start a new operation if one is already running
    if (syncProgress.isActive) return
    
    // Find the first operation that doesn't have a path conflict
    for (const operation of operationQueue) {
      if (!hasPathConflict(operation.paths)) {
        // Remove from queue before executing
        removeFromQueue(operation.id)
        
        try {
          await operation.execute()
        } catch (err) {
          console.error('Queue operation failed:', err)
          addToast('error', `Operation failed: ${operation.label}`)
        }
        
        // After completing, try to process more from the queue
        setTimeout(() => get().processQueue(), 100)
        return
      }
    }
    
    // All operations have conflicts, will try again when a processing folder is removed
  },
  
  // Actions - Notifications & Reviews
  setUnreadNotificationCount: (count) => set({ unreadNotificationCount: count }),
  setPendingReviewCount: (count) => set({ pendingReviewCount: count }),
  incrementNotificationCount: () => set(state => ({ unreadNotificationCount: state.unreadNotificationCount + 1 })),
  decrementNotificationCount: (amount = 1) => set(state => ({ 
    unreadNotificationCount: Math.max(0, state.unreadNotificationCount - amount) 
  })),
  
  // Actions - Orphaned checkouts
  addOrphanedCheckout: (checkout: OrphanedCheckout) => set(state => ({
    orphanedCheckouts: [...state.orphanedCheckouts.filter(c => c.fileId !== checkout.fileId), checkout]
  })),
  removeOrphanedCheckout: (fileId) => set(state => ({
    orphanedCheckouts: state.orphanedCheckouts.filter(c => c.fileId !== fileId)
  })),
  clearOrphanedCheckouts: () => set({ orphanedCheckouts: [] }),
  
  // Actions - Staged check-ins
  stageCheckin: (checkin: StagedCheckin) => set(state => ({
    stagedCheckins: [...state.stagedCheckins.filter(c => c.relativePath !== checkin.relativePath), checkin]
  })),
  unstageCheckin: (relativePath) => set(state => ({
    stagedCheckins: state.stagedCheckins.filter(c => c.relativePath !== relativePath)
  })),
  updateStagedCheckinComment: (relativePath, comment) => set(state => ({
    stagedCheckins: state.stagedCheckins.map(c => 
      c.relativePath === relativePath ? { ...c, comment } : c
    )
  })),
  clearStagedCheckins: () => set({ stagedCheckins: [] }),
  getStagedCheckin: (relativePath) => get().stagedCheckins.find(c => c.relativePath === relativePath),
  
  // Actions - Missing storage files
  setMissingStorageFiles: (files: MissingStorageFile[]) => set({ missingStorageFiles: files }),
  clearMissingStorageFiles: () => set({ missingStorageFiles: [] }),
})
