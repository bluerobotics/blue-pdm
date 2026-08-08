/**
 * Vault Audit - an administrator's view of the read-only divergence scan.
 *
 * The scan has existed as `npm run scan:divergence` since it was written, which put the one person
 * who most needs its answer behind a terminal. This is the same scan, the same classification and
 * the same artifact, presented so that "do BluePLM and my files still agree?" can be answered from
 * the application.
 *
 * ## What writes, and what does not
 *
 * The scan reads. Nothing in it opens a vault file for writing, and the documents are the only
 * surviving copy of what the configuration-map wipe destroyed, so that is not going to change.
 *
 * The writes live inside `VaultAuditFindings`, one category at a time, and only over what the
 * administrator has ticked. There used to be a separate repair section at the bottom of this page;
 * it was a second list of the same values with checkboxes the findings table did not have, and
 * nothing on screen explained how the two related. Choosing what is wrong and fixing it are one
 * task and are now in one place.
 *
 * Neither writer is made safe by anything in this file. The database one is bounded by a
 * `computed || existing` merge inside a `SECURITY DEFINER` function that gates on organization
 * membership and admin role; the document one is the Sync Metadata command, which refuses any file
 * that is not local-only or checked out by the caller. The admin check here decides what is worth
 * rendering, and that is all it decides.
 */

import { useState } from 'react'
import { AlertTriangle, Lock, Trash2 } from 'lucide-react'

import { SwServiceVersionNotice } from '@/components/shared'
import { t } from '@/lib/i18n'
import { SW_SERVICE_VERSION_DOCUMENT_MANAGER_READ } from '@/lib/swServiceVersion'
import type { VaultAuditCategoryKind } from '@/types/vaultAudit'

import { useVaultAudit } from './useVaultAudit'
import { VaultAuditCategories } from './VaultAuditCategories'
import { VaultAuditCoverage } from './VaultAuditCoverage'
import { VaultAuditFieldTable } from './VaultAuditFieldTable'
import { VaultAuditFindings } from './VaultAuditFindings'
import { VaultAuditOverview } from './VaultAuditOverview'
import { VaultAuditProgress } from './VaultAuditProgress'
import { VaultAuditRevisionRule } from './VaultAuditRevisionRule'
import { VaultAuditScopeForm } from './VaultAuditScopeForm'
import { hasEvidence } from './vaultAuditView'

function AdminOnlyNotice() {
  return (
    <div className="flex items-start gap-2 p-3 rounded-md border border-plm-border bg-plm-bg-lighter">
      <Lock size={14} className="text-plm-fg-muted mt-0.5 flex-shrink-0" />
      <p className="text-sm text-plm-fg-muted">{t('vaultAudit.adminOnly')}</p>
    </div>
  )
}

export function VaultAuditSettings() {
  const audit = useVaultAudit()
  const [selectedCategory, setSelectedCategory] = useState<VaultAuditCategoryKind | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-plm-fg mb-1">{t('vaultAudit.title')}</h2>
        <p className="text-sm text-plm-fg-muted">{t('vaultAudit.description')}</p>
      </div>

      {!audit.isAdmin ? (
        <AdminOnlyNotice />
      ) : (
        <>
          <p className="text-xs text-plm-fg-muted">{t('vaultAudit.readOnlyNote')}</p>

          {audit.serviceCheck && (
            <SwServiceVersionNotice
              check={audit.serviceCheck}
              requirement={
                audit.serviceTooOld
                  ? t('vaultAudit.serviceTooOld', {
                      version: SW_SERVICE_VERSION_DOCUMENT_MANAGER_READ,
                    })
                  : undefined
              }
            />
          )}

          <VaultAuditScopeForm
            scope={audit.scope}
            onScopeChange={audit.setScope}
            isRunning={audit.isRunning}
            canScan={audit.canScan}
            blocked={audit.serviceTooOld}
            cancelRequested={audit.cancelRequested}
            hasResult={audit.view !== null}
            onStart={audit.start}
            onCancel={audit.cancel}
          />

          {audit.isRunning && <VaultAuditProgress progress={audit.progress} />}

          {audit.runState === 'failed' && audit.error && (
            <p className="text-sm text-plm-error flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              {audit.error}
            </p>
          )}

          {audit.view && (
            <div className="space-y-6 pt-4 border-t border-plm-border">
              <VaultAuditOverview view={audit.view} artifactPath={audit.artifactPath} />

              {/*
                Every section below is a count over files that were read, and every one of them
                reads as an all-clear at zero - "no findings", "every record describes exactly the
                configurations its file has", in green. A run that compared nothing earns none of
                those statements, so it gets the overview's explanation on its own.
              */}
              {hasEvidence(audit.view) && (
                <>
                  <VaultAuditCoverage coverage={audit.view.coverage} />

                  {/* Above the categories because it changes their counts. Reading a total and
                      then finding the rule that produced it underneath is the wrong order. */}
                  <VaultAuditRevisionRule
                    expectRevisionOnModels={audit.expectRevisionOnModels}
                    hiddenCount={audit.view.revisionOnModelsHidden}
                    onChange={audit.setExpectRevisionOnModels}
                  />

                  <VaultAuditCategories
                    categories={audit.view.categories}
                    selected={selectedCategory}
                    onSelect={setSelectedCategory}
                  />

                  <VaultAuditFindings findings={audit.view.findings} kind={selectedCategory} />

                  <VaultAuditFieldTable tallies={audit.view.fieldTallies} />
                </>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-plm-border">
                <p className="text-xs text-plm-fg-muted max-w-2xl">
                  {t('vaultAudit.result.notStored')}
                </p>
                <button
                  onClick={() => {
                    setSelectedCategory(null)
                    audit.clear()
                  }}
                  disabled={audit.isRunning}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-plm-fg-muted hover:text-plm-fg bg-plm-bg-lighter hover:bg-plm-bg-light border border-plm-border rounded-md transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  <Trash2 size={12} />
                  {t('vaultAudit.clear')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
