/**
 * Composite keys for the enrichment taxonomy filter.
 *
 * The taxonomy is two levels and the sidebar lets you select either one, so a
 * single filter list has to hold both. A parent selection is stored as the
 * bare category and matches every subcategory beneath it.
 */

const SEPARATOR = '::'

export function categoryKey(
  category: string | null | undefined,
  subcategory?: string | null,
): string {
  if (!category) return 'unclassified'
  return subcategory ? `${category}${SEPARATOR}${subcategory}` : category
}

export function parseCategoryKey(key: string): { category: string; subcategory: string | null } {
  const [category, subcategory] = key.split(SEPARATOR)
  return { category, subcategory: subcategory ?? null }
}

/**
 * Whether a row's classification satisfies the selected taxonomy keys.
 *
 * Selecting a parent category keeps every leaf under it, so drilling from the
 * donut into a category does not require expanding the sidebar tree first.
 */
export function matchesCategoryFilter(
  selected: string[],
  category: string | null,
  subcategory: string | null,
): boolean {
  if (selected.length === 0) return true
  if (!category) return selected.includes('unclassified')

  return selected.some((key) => key === category || key === categoryKey(category, subcategory))
}
