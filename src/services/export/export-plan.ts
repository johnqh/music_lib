/**
 * What an export writes, decided before anything is written.
 *
 * Both apps offer the same menu of formats and each spelled it out: the web as
 * six handlers in `AppLayout`, each pairing a scope, a target score and a
 * filename; the native app as its own `EXPORT_FORMATS` and extension table.
 * The formats, their extensions, their labels and the choice of which score a
 * scope means are facts about the product, so they are here once — and the
 * docs table of export formats is derived from the same list, so the menu and
 * the documentation cannot come to disagree. That list and the plan's shape
 * are vocabulary, in music_types; deciding a plan is here, because export is
 * not editing.
 *
 * What stays with the host is everything platform- or package-bound: naming
 * the file (`exportFilename`, applied to `title` and `extension`), rendering
 * audio (music_player), fitting a tracker module (music_lib's
 * `scoreToTracker`) and the write itself (music_io). `route` says which of
 * those a format needs.
 */
import { WRITABLE_EXPORT_FORMATS } from '@sudobility/music_types';
import type {
  ExportFormatId,
  ExportPlan,
  ExportScope,
} from '@sudobility/music_types';
import { exportTargetScore } from '@sudobility/music_editing';
import type { EditingState, EditingStoreApi } from '@sudobility/music_editing';

/**
 * The plan for writing `format` at `scope`, or null with no score.
 *
 * A project file ignores the scope: it *is* the document, and hiding a track
 * is a view preference — saving the project must not throw a part away.
 */
export function planExport<T extends EditingState>(
  store: EditingStoreApi<T>,
  format: ExportFormatId,
  scope: ExportScope
): ExportPlan | null {
  const entry = WRITABLE_EXPORT_FORMATS.find(f => f.id === format);
  if (!entry) return null;
  const target = exportTargetScore(
    store,
    entry.route === 'project' ? 'all' : scope
  );
  if (!target) return null;
  return {
    format: entry.id,
    extension: entry.extension,
    route: entry.route,
    target,
    title: target.metadata.title,
  };
}
