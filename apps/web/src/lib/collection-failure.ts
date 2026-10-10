export type CollectionStage =
  'network' | 'protocol' | 'schema' | 'database' | 'transaction' | 'recovery';
export interface CollectionDiagnostic {
  stage: CollectionStage;
  code: string;
  entity?: string;
  field?: string;
}

/** Only fixed codes and schema field names, never values, IDs or exception messages. */
export class CollectionFailure extends Error {
  constructor(readonly diagnostic: CollectionDiagnostic) {
    super(`collection_${diagnostic.stage}_${diagnostic.code}`);
  }
}

export function collectionDiagnostic(error: unknown, stage: CollectionStage): CollectionDiagnostic {
  if (error instanceof CollectionFailure) return error.diagnostic;
  const allowed = [
    'QuotaExceededError',
    'SecurityError',
    'VersionError',
    'AbortError',
    'InvalidStateError',
    'NotFoundError',
    'UnknownError',
  ];
  const code =
    error instanceof DOMException && allowed.includes(error.name)
      ? error.name
      : error instanceof Error &&
          [
            'collection_open_timeout',
            'collection_read_timeout',
            'collection_transaction_timeout',
            'collection_delete_timeout',
            'collection_blocked',
            'collection_incompatible',
            'collection_incomplete',
            'collection_aborted',
            'collection_failed',
          ].includes(error.message)
        ? error.message
        : 'failed';
  return { stage, code };
}
