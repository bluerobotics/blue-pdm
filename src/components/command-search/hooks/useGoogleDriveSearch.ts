import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { usePDMStore } from '../../../stores/pdmStore'
import type { SearchFilter, GoogleDriveFileResult } from '../types'

/**
 * Hook for searching Google Drive files
 */
export function useGoogleDriveSearch(searchTerm: string, filter: SearchFilter) {
  const { gdriveAuthVersion } = usePDMStore()
  
  const [driveResults, setDriveResults] = useState<GoogleDriveFileResult[]>([])
  const [isDriveSearching, setIsDriveSearching] = useState(false)
  const driveSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Check if Google Drive is authenticated (re-check when auth version changes)
  const isGdriveConnected = useMemo(() => {
    const token = localStorage.getItem('gdrive_access_token')
    const expiry = localStorage.getItem('gdrive_token_expiry')
    if (!token || !expiry) return false
    return Date.now() < parseInt(expiry, 10)
  }, [gdriveAuthVersion])

  // Search Google Drive files
  const searchGoogleDrive = useCallback(async (term: string) => {
    const token = localStorage.getItem('gdrive_access_token')
    if (!token || !term.trim()) {
      setDriveResults([])
      return
    }
    
    setIsDriveSearching(true)
    try {
      // Use Google Drive API's fullText search
      const query = `name contains '${term.replace(/'/g, "\\'")}' and trashed = false`
      const fields = 'files(id,name,mimeType,webViewLink,iconLink,modifiedTime,owners)'
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${fields}&pageSize=10&orderBy=modifiedTime desc`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      
      if (response.ok) {
        const data = await response.json()
        setDriveResults(data.files || [])
      } else {
        setDriveResults([])
      }
    } catch (err) {
      console.error('Google Drive search failed:', err)
      setDriveResults([])
    } finally {
      setIsDriveSearching(false)
    }
  }, [])

  // Debounced Google Drive search when filter is 'drive' or 'all' and connected
  useEffect(() => {
    if (!isGdriveConnected) {
      setDriveResults([])
      return
    }
    
    const shouldSearchDrive = filter === 'drive' || filter === 'all'
    if (!shouldSearchDrive || !searchTerm) {
      setDriveResults([])
      return
    }
    
    // Debounce the search
    if (driveSearchTimeoutRef.current) {
      clearTimeout(driveSearchTimeoutRef.current)
    }
    
    driveSearchTimeoutRef.current = setTimeout(() => {
      searchGoogleDrive(searchTerm)
    }, 300)
    
    return () => {
      if (driveSearchTimeoutRef.current) {
        clearTimeout(driveSearchTimeoutRef.current)
      }
    }
  }, [searchTerm, filter, isGdriveConnected, searchGoogleDrive])

  return {
    driveResults,
    isDriveSearching,
    isGdriveConnected,
  }
}
