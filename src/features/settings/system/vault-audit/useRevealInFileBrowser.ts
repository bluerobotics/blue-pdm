/**
 * Take a finding's vault-relative path back to the file it is about.
 *
 * A finding names a value in a file, and the only useful next move is to look at that file. This
 * leaves settings, opens the containing folder with its ancestors expanded, selects the file and
 * scrolls to it - the same sequence the command palette and the item browser use, so the result
 * looks like every other jump in the app.
 */

import { useCallback } from 'react'

import { usePDMStore } from '@/stores/pdmStore'

export interface RevealInFileBrowser {
  /** Absolute path of the loaded file, or null when it has no local copy to show. */
  resolve: (relativePath: string) => string | null
  reveal: (relativePath: string) => void
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

export function useRevealInFileBrowser(): RevealInFileBrowser {
  const files = usePDMStore((state) => state.files)
  const expandedFolders = usePDMStore((state) => state.expandedFolders)
  const toggleFolder = usePDMStore((state) => state.toggleFolder)
  const setCurrentFolder = usePDMStore((state) => state.setCurrentFolder)
  const setSelectedFiles = usePDMStore((state) => state.setSelectedFiles)
  const setPendingScrollToFile = usePDMStore((state) => state.setPendingScrollToFile)
  const setActiveView = usePDMStore((state) => state.setActiveView)

  const resolve = useCallback(
    (relativePath: string) => {
      const wanted = normalize(relativePath)
      return files.find((file) => normalize(file.relativePath) === wanted)?.path ?? null
    },
    [files],
  )

  const reveal = useCallback(
    (relativePath: string) => {
      const absolutePath = resolve(relativePath)
      if (!absolutePath) return

      const parts = relativePath.replace(/\\/g, '/').split('/')
      parts.pop()

      for (let depth = 1; depth <= parts.length; depth++) {
        const ancestor = parts.slice(0, depth).join('/')
        if (ancestor && !expandedFolders.has(ancestor)) toggleFolder(ancestor)
      }

      setCurrentFolder(parts.join('/'))
      setSelectedFiles([absolutePath])
      setPendingScrollToFile(absolutePath)
      setActiveView('explorer')
    },
    [
      resolve,
      expandedFolders,
      toggleFolder,
      setCurrentFolder,
      setSelectedFiles,
      setPendingScrollToFile,
      setActiveView,
    ],
  )

  return { resolve, reveal }
}
