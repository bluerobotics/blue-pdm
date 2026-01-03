import { StateCreator } from 'zustand'
import type { PDMStoreState, UpdateSlice, ToastType } from '../types'

export const createUpdateSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  UpdateSlice
> = (set) => ({
  // Initial state
  updateAvailable: null,
  updateDownloading: false,
  updateDownloaded: false,
  updateProgress: null,
  showUpdateModal: false,
  installerPath: null,
  
  // Actions
  setUpdateAvailable: (info) => set({ updateAvailable: info }),
  setUpdateDownloading: (downloading) => set({ updateDownloading: downloading }),
  setUpdateDownloaded: (downloaded) => set({ updateDownloaded: downloaded }),
  setUpdateProgress: (progress) => set({ updateProgress: progress }),
  setShowUpdateModal: (show) => set({ showUpdateModal: show }),
  setInstallerPath: (path) => set({ installerPath: path }),
  
  showUpdateToast: (version: string) => {
    const id = 'update-available'
    // Remove existing update toast if any
    set(state => ({
      toasts: [
        ...state.toasts.filter(t => t.id !== id),
        { id, type: 'update' as ToastType, message: `Version ${version} is available`, duration: 0 }
      ]
    }))
  },
  
  dismissUpdateToast: () => {
    set(state => ({ toasts: state.toasts.filter(t => t.id !== 'update-available') }))
  },
})
