/**
 * The set of running metadata writes, as React reads it.
 *
 * The registry itself lives in `lib/metadata/writeInFlight`, outside React, because check-in has
 * to consult it and a command handler cannot read component state. This is the subscription that
 * lets a row still show a spinner while a write it did not start is running.
 */

import { useSyncExternalStore } from 'react'

import {
  metadataWritesInFlight,
  subscribeToMetadataWrites,
} from '@/lib/metadata/writeInFlight'

export function useMetadataWritesInFlight(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeToMetadataWrites, metadataWritesInFlight)
}
