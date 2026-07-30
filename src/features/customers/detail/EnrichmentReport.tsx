import { useMemo } from 'react'
import { AlertTriangle, ExternalLink, Sparkles } from 'lucide-react'

import type { EnrichmentRecord } from '../hooks/useCustomerDetail'
import { formatDate, formatPercent } from '../lib/format'

/**
 * The AI research report for an account, with its citations as linked evidence.
 *
 * Read-only by design: no endpoint exists to run enrichment from the client
 * (only the batch API path does), so this displays what research has already
 * been paid for and cannot trigger more.
 */
export function EnrichmentReport({ enrichment }: { enrichment: EnrichmentRecord | null }) {
  if (!enrichment) {
    return (
      <div className="px-3 py-4 text-center">
        <Sparkles size={16} className="mx-auto text-plm-fg-muted/60 mb-1.5" />
        <p className="text-xs text-plm-fg-dim">No research on this account</p>
        <p className="text-[11px] text-plm-fg-muted mt-0.5">
          Enrichment runs as a batch job on the API server and cannot be started from here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {enrichment.confidence != null && (
          <span className="text-plm-fg-muted">
            Confidence{' '}
            <span className="text-plm-fg tabular-nums">
              {formatPercent(enrichment.confidence, 0)}
            </span>
          </span>
        )}
        {enrichment.researched_at && (
          <span className="text-plm-fg-muted">
            Researched <span className="text-plm-fg">{formatDate(enrichment.researched_at)}</span>
          </span>
        )}
        {enrichment.model && <span className="text-plm-fg-muted">{enrichment.model}</span>}
      </div>

      {enrichment.needs_review && (
        <div className="flex items-start gap-2 p-2 rounded bg-plm-warning/10 border border-plm-warning/30">
          <AlertTriangle size={12} className="text-plm-warning flex-shrink-0 mt-0.5" />
          <span className="text-[11px] text-plm-fg-dim">
            Flagged for review: the model returned a classification outside the taxonomy, or the
            evidence was thin.
          </span>
        </div>
      )}

      {!enrichment.evidence_found && (
        <p className="text-[11px] text-plm-fg-muted italic">
          The research found no reliable public evidence about this account.
        </p>
      )}

      {enrichment.report && <ReportBody markdown={enrichment.report} />}

      {enrichment.sources.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[10px] uppercase tracking-wide text-plm-fg-muted">
            Sources ({enrichment.sources.length})
          </h4>
          {enrichment.sources.map((source, index) => (
            <a
              key={source.id}
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              className="block p-2 rounded border border-plm-border bg-plm-bg-light hover:border-plm-accent/50 transition-colors group"
            >
              <div className="flex items-start gap-1.5">
                <span className="text-[10px] text-plm-fg-muted tabular-nums mt-px">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-plm-fg truncate group-hover:text-plm-accent">
                      {source.title || hostOf(source.url)}
                    </span>
                    <ExternalLink size={9} className="text-plm-fg-muted shrink-0" />
                  </div>
                  <div className="text-[10px] text-plm-fg-muted truncate">{hostOf(source.url)}</div>
                  {source.quote && (
                    <p className="mt-1 text-[10px] text-plm-fg-dim italic border-l-2 border-plm-border-light pl-1.5 line-clamp-3">
                      {source.quote}
                    </p>
                  )}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Minimal markdown rendering for the report body.
 *
 * The app has no markdown renderer dependency, and pulling one in for headings
 * and bullets in a side panel is not worth the bundle. Anything unrecognised
 * falls through as a plain paragraph, and nothing is set as HTML, so a model
 * emitting a script tag renders as text.
 */
function ReportBody({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => {
    return markdown
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        if (line.startsWith('### ')) return { kind: 'heading' as const, text: line.slice(4), index }
        if (line.startsWith('## ')) return { kind: 'heading' as const, text: line.slice(3), index }
        if (line.startsWith('# ')) return { kind: 'heading' as const, text: line.slice(2), index }
        if (/^[-*]\s+/.test(line))
          return { kind: 'bullet' as const, text: line.replace(/^[-*]\s+/, ''), index }
        return { kind: 'text' as const, text: line, index }
      })
  }, [markdown])

  return (
    <div className="space-y-1.5">
      {blocks.map((block) => {
        if (block.kind === 'heading') {
          return (
            <h4 key={block.index} className="text-[11px] font-medium text-plm-fg pt-1">
              {stripInline(block.text)}
            </h4>
          )
        }
        if (block.kind === 'bullet') {
          return (
            <div key={block.index} className="flex gap-1.5 text-[11px] text-plm-fg-dim">
              <span className="text-plm-fg-muted">•</span>
              <span className="flex-1 leading-relaxed">{stripInline(block.text)}</span>
            </div>
          )
        }
        return (
          <p key={block.index} className="text-[11px] text-plm-fg-dim leading-relaxed">
            {stripInline(block.text)}
          </p>
        )
      })}
    </div>
  )
}

/** Drops inline bold/italic/code markers, which have no styling here. */
function stripInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1')
}
