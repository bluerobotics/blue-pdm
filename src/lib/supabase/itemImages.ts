import { getSupabaseClient } from './client'

import { log } from '@/lib/logger'
import type { ItemImage } from '@/types/item'

const VAULT_BUCKET = 'vault'
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365 // 1 year (matches avatar/logo uploads)
const MAX_IMAGE_BYTES = 2 * 1024 * 1024 // 2 MB

// Shape returned by the item_images RPCs (snake_case, matches the DB row)
interface ItemImageRow {
  part_number: string
  image_type: ItemImage['type']
  icon_name: string | null
  icon_color: string | null
  image_storage_path: string | null
}

// Supabase v2 does not infer types for RPCs that are not yet in the generated
// supabase.ts. Cast to a loose caller until the types are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => Promise<any> } // TODO: type this after supabase types regen

function sanitizePartNumber(partNumber: string): string {
  return partNumber.replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 120) || 'item'
}

async function resolveSignedUrl(storagePath: string): Promise<string | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.storage
    .from(VAULT_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error) {
    log.error('[ItemImages]', 'Failed to sign item image URL', { error })
    return null
  }
  return data?.signedUrl ?? null
}

function toItemImage(row: ItemImageRow, imageUrl: string | null): ItemImage {
  return {
    partNumber: row.part_number,
    type: row.image_type,
    iconName: row.icon_name,
    iconColor: row.icon_color,
    imageUrl,
    storagePath: row.image_storage_path,
  }
}

/**
 * Load all per-item image overrides for an org, keyed by part number. Items
 * with no override row use the default SolidWorks preview and are absent here.
 */
export async function getItemImages(orgId: string): Promise<Map<string, ItemImage>> {
  const supabase = getSupabaseClient() as unknown as RpcClient
  const result = new Map<string, ItemImage>()
  try {
    const { data, error } = await supabase.rpc('get_item_images', { p_org_id: orgId })
    if (error) throw error
    const rows = (data ?? []) as ItemImageRow[]

    await Promise.all(
      rows.map(async (row) => {
        const imageUrl =
          row.image_type === 'image' && row.image_storage_path
            ? await resolveSignedUrl(row.image_storage_path)
            : null
        result.set(row.part_number, toItemImage(row, imageUrl))
      }),
    )
    return result
  } catch (error) {
    log.error('[ItemImages]', 'Failed to load item images', { error })
    return result
  }
}

/** Set an item's override to a Lucide icon (optionally colored). */
export async function setItemIcon(
  orgId: string,
  partNumber: string,
  iconName: string,
  iconColor?: string | null,
): Promise<ItemImage> {
  const supabase = getSupabaseClient() as unknown as RpcClient
  const { data, error } = await supabase.rpc('upsert_item_image', {
    p_org_id: orgId,
    p_part_number: partNumber,
    p_image_type: 'icon',
    p_icon_name: iconName,
    p_icon_color: iconColor ?? null,
    p_image_storage_path: null,
  })
  if (error) throw error
  return toItemImage(data as ItemImageRow, null)
}

/** Upload an image for an item and set it as the item's override. */
export async function uploadItemImage(
  orgId: string,
  partNumber: string,
  file: File,
): Promise<ItemImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file')
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Image must be 2 MB or smaller')
  }

  const supabase = getSupabaseClient()
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const storagePath = `${orgId}/_assets/item-images/${sanitizePartNumber(partNumber)}-${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(VAULT_BUCKET)
    .upload(storagePath, file, { cacheControl: '3600', upsert: true })
  if (uploadError) throw uploadError

  const rpcClient = supabase as unknown as RpcClient
  const { data, error } = await rpcClient.rpc('upsert_item_image', {
    p_org_id: orgId,
    p_part_number: partNumber,
    p_image_type: 'image',
    p_icon_name: null,
    p_icon_color: null,
    p_image_storage_path: storagePath,
  })
  if (error) throw error

  const imageUrl = await resolveSignedUrl(storagePath)
  return toItemImage(data as ItemImageRow, imageUrl)
}

/** Remove an item's override, reverting to the default SolidWorks preview. */
export async function resetItemImage(orgId: string, partNumber: string): Promise<void> {
  const supabase = getSupabaseClient() as unknown as RpcClient
  const { error } = await supabase.rpc('reset_item_image', {
    p_org_id: orgId,
    p_part_number: partNumber,
  })
  if (error) throw error
}
