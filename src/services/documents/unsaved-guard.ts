/**
 * What to do about unwritten work when a document — or the app — is closing.
 *
 * A pure decision, no dialog: "may this close?" has one rule and a small set of
 * outcomes, and keeping it out of a component is what lets the same rule serve
 * a tab's close button, a window close and a quit. It was the native app's
 * alone; the web app closes a project too, and a second statement of "what
 * counts as unsaved" is the kind that drifts.
 *
 * Generic over anything with a `dirty` flag rather than a concrete document
 * type, because the two apps hold a document differently and the question
 * only needs the one bit. A never-saved document counts exactly as a dirty one
 * with a file: both have work that would be lost, and only the remedy differs —
 * choosing the remedy is the caller's job.
 */

/** The one fact the guard needs about a document. */
export type GuardedDocument = { readonly dirty: boolean };

export type CloseDecision<D extends GuardedDocument = GuardedDocument> =
  /** Nothing to lose — close it. */
  | { kind: 'close' }
  /** Work would be lost; ask, naming what. */
  | { kind: 'confirm'; documents: readonly D[] };

/** Whether one document has work that is not written anywhere. */
export function hasUnwrittenWork(doc: GuardedDocument): boolean {
  return doc.dirty;
}

export function decideClose<D extends GuardedDocument>(
  doc: D
): CloseDecision<D> {
  return hasUnwrittenWork(doc)
    ? { kind: 'confirm', documents: [doc] }
    : { kind: 'close' };
}

/**
 * The same question for the whole app.
 *
 * Every unwritten document is named at once rather than one prompt per
 * document: three dialogs in a row is how somebody clicks "discard" on the one
 * they meant to keep.
 */
export function decideQuit<D extends GuardedDocument>(
  documents: readonly D[]
): CloseDecision<D> {
  const unwritten = documents.filter(hasUnwrittenWork);
  return unwritten.length === 0
    ? { kind: 'close' }
    : { kind: 'confirm', documents: unwritten };
}
