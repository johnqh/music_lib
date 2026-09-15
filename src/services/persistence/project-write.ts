/**
 * A save to a server project, as the autosave sends it.
 *
 * Shared by the web app's project slice and the per-document store, because
 * what a save carries is a rule about the server and not about either store.
 * Reads return the score; writes return metadata about it — so the score goes
 * up and nothing comes back but where the write left the server.
 */
import type {
  ProjectSaveResult,
  ProjectUpdateRequest,
} from '@sudobility/music_types';
import { authorizedServer, type StoreContext } from '../../store/context.js';
import type { SaveWrite } from './document-saver.js';

/** What a project save reads off the store at the moment it runs. */
export type ProjectWriteFields = {
  name: string;
  zoom: number;
  visibleTrackIds: string[] | null;
};

export function projectWrite(
  context: StoreContext,
  projectId: () => string,
  read: () => ProjectWriteFields,
  onSaved?: (saved: ProjectSaveResult) => void
): SaveWrite {
  return async ({ score, scoreChanged }) => {
    const { client, token } = await authorizedServer(context);
    const { name, zoom, visibleTrackIds } = read();
    const body: ProjectUpdateRequest = {
      name,
      // Omitted when the score has not moved since the last save. A visibility
      // toggle marks the project dirty like any other change, and used to ship
      // the entire score to record a list of track ids.
      ...(scoreChanged ? { score } : {}),
      // zoom rides along because ProjectUiPrefs requires it. Changing it
      // deliberately does NOT mark the project dirty, so it persists
      // opportunistically on the next real save rather than adding a write per
      // click of the zoom button.
      uiPrefs: {
        zoom,
        ...(visibleTrackIds ? { visibleTrackIds } : {}),
      },
    };
    const saved = await client.updateProject(projectId(), body, token);
    onSaved?.(saved);
    return { updatedAt: saved.updatedAt };
  };
}
