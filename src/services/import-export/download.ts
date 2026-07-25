/**
 * Browser file-download helper (spec §16/§17/§18/§19: "Download action" for
 * MIDI/MusicXML/project-JSON export). A tiny wrapper around the standard
 * "object URL + synthetic anchor click" pattern so every export call site
 * shares one implementation instead of re-deriving it.
 */

/** Triggers a browser download of `blob` named `name`. */
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(url);
  }
}
