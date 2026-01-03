import { StateCreator } from 'zustand'
import type { PDMStoreState, ToastsSlice, ToastType } from '../types'

export const createToastsSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  ToastsSlice
> = (set, get) => ({
  // Initial state
  toasts: [],
  
  // Actions
  addToast: (type: ToastType, message: string, duration = 5000) => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    set(state => ({ toasts: [...state.toasts, { id, type, message, duration }] }))
  },
  
  addProgressToast: (id: string, message: string, total: number) => {
    set(state => ({ 
      toasts: [...state.toasts, { 
        id, 
        type: 'progress', 
        message, 
        duration: 0, // Don't auto-dismiss progress toasts
        progress: { current: 0, total, percent: 0 }
      }] 
    }))
  },
  
  updateProgressToast: (id: string, current: number, percent: number, speed?: string, label?: string) => {
    set(state => ({
      toasts: state.toasts.map(t => 
        t.id === id && t.type === 'progress'
          ? { ...t, progress: { ...t.progress!, current, percent, speed, label } }
          : t
      )
    }))
  },
  
  requestCancelProgressToast: (id: string) => {
    set(state => ({
      toasts: state.toasts.map(t => 
        t.id === id && t.type === 'progress' && t.progress
          ? { ...t, progress: { ...t.progress, cancelRequested: true } }
          : t
      )
    }))
  },
  
  isProgressToastCancelled: (id: string) => {
    const toast = get().toasts.find(t => t.id === id)
    return toast?.progress?.cancelRequested || false
  },
  
  removeToast: (id: string) => {
    set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }))
  },
})
