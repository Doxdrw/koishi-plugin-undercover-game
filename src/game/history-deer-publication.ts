import { createHash } from 'node:crypto'

export interface DeerPublicationMark {
  tenureId: string
  version: string
  digest: string
  confirmed: boolean
}

/** Mutable disclosure evidence in the stored header, outside the archive digest. */
export interface DeerPublicationMetadata {
  deerPublications?: DeerPublicationMark[]
}

export function deerChoiceDigest(row: { tenureId: string; choice: string | null }): string {
  return createHash('sha256').update(JSON.stringify([row.tenureId, row.choice])).digest('hex')
}

export function readDeerPublications(header: DeerPublicationMetadata): DeerPublicationMark[] {
  return Array.isArray(header.deerPublications) ? header.deerPublications : []
}
