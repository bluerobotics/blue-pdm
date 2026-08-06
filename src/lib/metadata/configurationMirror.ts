/**
 * Copying a file-scope value down into a configuration, and knowing when not to.
 *
 * A drawing's title block reads `$PRP:"Description"` in the context of whichever configuration the
 * view shows. SolidWorks resolves that against the configuration's own bag first and the document's
 * only if the configuration has no property of that name, so a document-scope edit alone can leave
 * a title block showing nothing. The datacard therefore copies what it just wrote at file level
 * into the active configuration.
 *
 * The whole difficulty is which configurations that copy may touch. The mirror used to test the
 * configuration's value for truthiness, so an empty one counted as absent and was refilled from
 * file level. That undid the distinction 1.19.0 exists to make: the service now writes a cleared
 * property as an empty one rather than deleting it, precisely so that "this configuration says
 * nothing" can be stated and kept. Clearing the file-level Description is not a request to stamp
 * the old text back into a configuration the user emptied on purpose.
 *
 * So presence decides, as it does everywhere else in this folder:
 *
 * - the configuration has no property of that name - nothing to lose, and a reader falls through to
 *   the document anyway, so the copy only makes explicit what is already resolved;
 * - the configuration holds a property reference - it resolves elsewhere rather than holding a
 *   value, so replacing it with the value it was reaching for loses nothing;
 * - otherwise the configuration holds its own value, empty string included, and keeps it.
 *
 * Pure, and separate from the panel that calls it, because the rule is the part worth pinning down.
 */

import { isPropertyReference } from './divergence'

/**
 * Which of the values just written at file level may be copied into one configuration.
 *
 * `own` is the configuration's own bag - `configurationScopeProperties`, not the resolved view.
 * Passing the resolved view would make every key look present and the mirror would never write.
 */
export function propertiesToMirror(
  fileScope: Readonly<Record<string, string>>,
  own: Readonly<Record<string, string>>,
): Record<string, string> {
  const mirrored: Record<string, string> = {}

  for (const [key, value] of Object.entries(fileScope)) {
    const existing = own[key]
    if (existing === undefined || isPropertyReference(existing)) {
      mirrored[key] = value
    }
  }

  return mirrored
}
