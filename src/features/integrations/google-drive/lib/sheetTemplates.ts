/**
 * Google Sheets inspection template generation.
 *
 * Builds a filled-in Google Sheet from a user-authored template stored in a Drive folder.
 * The template is copied (Drive `files.copy`) and then populated (Sheets API v4) with:
 *   - scalar tokens ({{BR_NUMBER}}, {{PART_NAME}}, {{REVISION}}, {{DATE}}, {{DRAWING_NAME}})
 *   - a part preview image ({{PART_PREVIEW}} -> =IMAGE("<url>"))
 *   - the inspection characteristics table (rows expand from the {{INSPECTION_TABLE}} anchor,
 *     one column per {{COL:<field>}} header token)
 *
 * Auth reuses the legacy per-user Google Drive OAuth token (localStorage), so the org must
 * have Google Drive connected and the user signed in. The Sheets scope is granted alongside
 * Drive scopes in the Electron OAuth flow.
 */

import { log } from '@/lib/logger'

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets'
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet'

/** Special token that becomes an =IMAGE() formula rather than plain text. */
const PART_PREVIEW_TOKEN = 'PART_PREVIEW'
/** Anchor token marking the top-left cell of the inspection table body. */
const TABLE_ANCHOR_RE = /\{\{INSPECTION_TABLE\}\}/
/** Header token declaring which inspection field maps to a column, e.g. {{COL:balloon_number}}. */
const COLUMN_TOKEN_RE = /\{\{COL:([a-zA-Z0-9_]+)\}\}/

export interface InspectionTemplateFile {
  id: string
  name: string
}

export interface GenerateInspectionSheetParams {
  /** Drive file id of the template spreadsheet to copy. */
  templateId: string
  /** Drive folder id the generated report is created in (typically the template folder). */
  destinationFolderId: string
  /** Name for the generated spreadsheet. */
  reportName: string
  /** Plain-text token replacements, keyed by token name without braces (e.g. BR_NUMBER). */
  scalarTokens: Record<string, string>
  /** Public URL of the part preview image, or null to leave {{PART_PREVIEW}} blank. */
  previewImageUrl: string | null
  /** Inspection rows as pre-formatted cell strings keyed by field name. */
  rows: Array<Record<string, string>>
  /** Header label to substitute for each {{COL:<field>}} token, keyed by field name. */
  columnLabels: Record<string, string>
}

export interface GenerateInspectionSheetResult {
  success: boolean
  spreadsheetId?: string
  spreadsheetUrl?: string
  error?: string
}

interface SheetProperties {
  sheetId: number
  title: string
  gridProperties?: { rowCount?: number; columnCount?: number }
}

/** Read a valid (non-expired) Google Drive access token from localStorage, or null. */
export function getGoogleDriveToken(): string | null {
  const token = localStorage.getItem('gdrive_access_token')
  const expiry = localStorage.getItem('gdrive_token_expiry')
  if (!token || !expiry) return null
  if (Date.now() >= parseInt(expiry, 10)) return null
  return token
}

/** Whether the current user has a live Google Drive connection. */
export function isGoogleDriveConnected(): boolean {
  return getGoogleDriveToken() !== null
}

/** Build the shareable edit URL for a spreadsheet id. */
export function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}

/** Convert a 0-based column index to its A1 letter (0 -> A, 26 -> AA). */
function columnLetter(index: number): string {
  let result = ''
  let n = index
  do {
    result = String.fromCharCode((n % 26) + 65) + result
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return result
}

/** Quote a sheet title for A1 notation (wrap in single quotes, doubling embedded quotes). */
function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`
}

async function googleFetch<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const body = (await response.json()) as { error?: { message?: string } }
      if (body?.error?.message) message = body.error.message
    } catch {
      // response had no JSON body; keep status text
    }
    throw new Error(message)
  }

  return (await response.json()) as T
}

/**
 * List the Google Sheet templates in a Drive folder (used to populate the dropdown).
 */
export async function getInspectionTemplates(
  folderId: string,
): Promise<{ success: boolean; templates?: InspectionTemplateFile[]; error?: string }> {
  const token = getGoogleDriveToken()
  if (!token) return { success: false, error: 'NOT_CONNECTED' }

  const query = `'${folderId}' in parents and mimeType='${GOOGLE_SHEET_MIME}' and trashed=false`
  const url =
    `${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent('files(id,name)')}` +
    `&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`

  try {
    const data = await googleFetch<{ files?: InspectionTemplateFile[] }>(url, token)
    return { success: true, templates: data.files ?? [] }
  } catch (error) {
    log.error('[SheetTemplates]', 'Failed to list templates', { error: String(error) })
    return { success: false, error: String(error) }
  }
}

async function copyTemplate(
  token: string,
  templateId: string,
  name: string,
  destinationFolderId: string,
): Promise<string> {
  const url = `${DRIVE_FILES_URL}/${templateId}/copy?supportsAllDrives=true&fields=id`
  const body = JSON.stringify({ name, parents: [destinationFolderId] })
  const data = await googleFetch<{ id: string }>(url, token, { method: 'POST', body })
  return data.id
}

async function getSheetProperties(
  token: string,
  spreadsheetId: string,
): Promise<SheetProperties[]> {
  const fields = encodeURIComponent('sheets(properties(sheetId,title,gridProperties))')
  const url = `${SHEETS_URL}/${spreadsheetId}?fields=${fields}&includeGridData=false`
  const data = await googleFetch<{ sheets?: Array<{ properties: SheetProperties }> }>(url, token)
  return (data.sheets ?? []).map((sheet) => sheet.properties)
}

async function getSheetValues(
  token: string,
  spreadsheetId: string,
  title: string,
): Promise<string[][]> {
  const range = encodeURIComponent(quoteSheetTitle(title))
  const url = `${SHEETS_URL}/${spreadsheetId}/values/${range}?majorDimension=ROWS`
  const data = await googleFetch<{ values?: unknown[][] }>(url, token)
  return (data.values ?? []).map((row) => row.map((cell) => (cell == null ? '' : String(cell))))
}

interface ValueRange {
  range: string
  values: string[][]
}

interface ScalarHit {
  rowIndex: number
  colIndex: number
  value: string
}

interface TablePlan {
  anchorRowIndex: number
  /** field name -> 0-based column index (from {{COL:field}} header tokens). */
  columnMap: Record<string, number>
  /** Header cells to relabel: rowIndex/colIndex -> label. */
  headerHits: Array<{ rowIndex: number; colIndex: number; label: string }>
}

/**
 * Scan a sheet's cells for scalar tokens, the table anchor, and column tokens.
 * Returns scalar replacements and (if present) a table plan for the sheet.
 */
function scanSheet(
  values: string[][],
  scalarTokens: Record<string, string>,
  previewImageUrl: string | null,
  columnLabels: Record<string, string>,
): { scalarHits: ScalarHit[]; table: TablePlan | null } {
  const scalarHits: ScalarHit[] = []
  let anchorRowIndex = -1
  const columnMap: Record<string, number> = {}
  const headerHits: Array<{ rowIndex: number; colIndex: number; label: string }> = []

  for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex]
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const cell = row[colIndex]
      if (!cell || cell.indexOf('{{') === -1) continue

      // Column header token: {{COL:field}}
      const colMatch = cell.match(COLUMN_TOKEN_RE)
      if (colMatch) {
        const field = colMatch[1]
        columnMap[field] = colIndex
        headerHits.push({ rowIndex, colIndex, label: columnLabels[field] ?? field })
        continue
      }

      // Table anchor token
      if (TABLE_ANCHOR_RE.test(cell)) {
        anchorRowIndex = rowIndex
        // Clear the anchor marker itself
        scalarHits.push({ rowIndex, colIndex, value: cell.replace(TABLE_ANCHOR_RE, '').trim() })
        continue
      }

      // Part preview token becomes an IMAGE formula (or blank when unavailable)
      if (cell.includes(`{{${PART_PREVIEW_TOKEN}}}`)) {
        scalarHits.push({
          rowIndex,
          colIndex,
          value: previewImageUrl ? `=IMAGE("${previewImageUrl}")` : '',
        })
        continue
      }

      // Generic scalar tokens (may appear inline within surrounding text)
      let replaced = cell
      let changed = false
      for (const [name, replacement] of Object.entries(scalarTokens)) {
        const tokenText = `{{${name}}}`
        if (replaced.includes(tokenText)) {
          replaced = replaced.split(tokenText).join(replacement)
          changed = true
        }
      }
      if (changed) scalarHits.push({ rowIndex, colIndex, value: replaced })
    }
  }

  const table =
    anchorRowIndex >= 0 && Object.keys(columnMap).length > 0
      ? { anchorRowIndex, columnMap, headerHits }
      : null

  return { scalarHits, table }
}

/**
 * Generate a filled inspection spreadsheet from a template. Copies the template, then applies
 * token replacements and expands the inspection table.
 */
export async function generateInspectionSheet(
  params: GenerateInspectionSheetParams,
): Promise<GenerateInspectionSheetResult> {
  const token = getGoogleDriveToken()
  if (!token) return { success: false, error: 'NOT_CONNECTED' }

  try {
    const spreadsheetId = await copyTemplate(
      token,
      params.templateId,
      params.reportName,
      params.destinationFolderId,
    )

    const sheets = await getSheetProperties(token, spreadsheetId)
    if (sheets.length === 0) {
      return { success: false, error: 'Template has no sheets' }
    }

    const rowCount = params.rows.length
    const valueUpdates: ValueRange[] = []
    let tableSheetHandled = false

    for (const sheet of sheets) {
      const values = await getSheetValues(token, spreadsheetId, sheet.title)
      const { scalarHits, table } = scanSheet(
        values,
        params.scalarTokens,
        params.previewImageUrl,
        params.columnLabels,
      )

      // Only expand the table on the first sheet that declares one.
      const doTable = !!table && !tableSheetHandled
      if (doTable && table) tableSheetHandled = true

      // Insert extra rows so table data doesn't overwrite content below the anchor.
      let rowShift = 0
      if (doTable && table && rowCount > 1) {
        rowShift = rowCount - 1
        await insertRows(token, spreadsheetId, sheet.sheetId, table.anchorRowIndex + 1, rowShift)
      }

      // Scalar/header replacements (positions below the anchor shift down by rowShift).
      const shiftRow = (rowIndex: number): number =>
        doTable && table && rowIndex > table.anchorRowIndex ? rowIndex + rowShift : rowIndex

      for (const hit of scalarHits) {
        valueUpdates.push({
          range: `${quoteSheetTitle(sheet.title)}!${columnLetter(hit.colIndex)}${shiftRow(hit.rowIndex) + 1}`,
          values: [[hit.value]],
        })
      }

      if (doTable && table) {
        for (const header of table.headerHits) {
          valueUpdates.push({
            range: `${quoteSheetTitle(sheet.title)}!${columnLetter(header.colIndex)}${shiftRow(header.rowIndex) + 1}`,
            values: [[header.label]],
          })
        }

        // Write each mapped column as a vertical range starting at the anchor row.
        for (const [field, colIndex] of Object.entries(table.columnMap)) {
          const column: string[][] = params.rows.map((row) => [row[field] ?? ''])
          if (column.length === 0) continue
          const startRow = table.anchorRowIndex + 1
          const endRow = startRow + rowCount - 1
          valueUpdates.push({
            range: `${quoteSheetTitle(sheet.title)}!${columnLetter(colIndex)}${startRow}:${columnLetter(colIndex)}${endRow}`,
            values: column,
          })
        }
      }
    }

    if (valueUpdates.length > 0) {
      await batchUpdateValues(token, spreadsheetId, valueUpdates)
    }

    return { success: true, spreadsheetId, spreadsheetUrl: spreadsheetUrl(spreadsheetId) }
  } catch (error) {
    log.error('[SheetTemplates]', 'Failed to generate inspection sheet', { error: String(error) })
    return { success: false, error: String(error) }
  }
}

async function insertRows(
  token: string,
  spreadsheetId: string,
  sheetId: number,
  startIndex: number,
  count: number,
): Promise<void> {
  const url = `${SHEETS_URL}/${spreadsheetId}:batchUpdate`
  const body = JSON.stringify({
    requests: [
      {
        insertDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex, endIndex: startIndex + count },
          inheritFromBefore: true,
        },
      },
    ],
  })
  await googleFetch(url, token, { method: 'POST', body })
}

async function batchUpdateValues(
  token: string,
  spreadsheetId: string,
  data: ValueRange[],
): Promise<void> {
  const url = `${SHEETS_URL}/${spreadsheetId}/values:batchUpdate`
  const body = JSON.stringify({ valueInputOption: 'USER_ENTERED', data })
  await googleFetch(url, token, { method: 'POST', body })
}
