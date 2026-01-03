/**
 * Footer with keyboard navigation hints
 */
export function KeyboardHints() {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-t border-plm-border bg-plm-bg-light/50 text-[10px] text-plm-fg-muted">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 bg-plm-bg border border-plm-border rounded font-mono">↑↓</kbd>
          navigate
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 bg-plm-bg border border-plm-border rounded font-mono">↵</kbd>
          select
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 bg-plm-bg border border-plm-border rounded font-mono">esc</kbd>
          close
        </span>
      </div>
    </div>
  )
}
