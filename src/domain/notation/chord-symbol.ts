/**
 * Splitting a chord symbol into the parts MusicXML wants.
 *
 * The model stores the symbol as typed, because a lead sheet's vocabulary is
 * wide and inconsistent and nothing a player writes should be refused. But
 * MusicXML's `<harmony>` wants a `<root-step>` and an `<alter>` — so the root
 * has to come out of the string for export, and only the root.
 *
 * The rest is carried verbatim as the kind's display text with `kind="other"`.
 * That is a deliberate refusal to guess: mapping `-7`, `min7`, `m7`, `mi7` and
 * `−7` onto MusicXML's enumeration is a dictionary that is wrong for somebody,
 * and a symbol that round-trips as the exact text it was typed as is worth
 * more here than one classified into a taxonomy. A reader that understands
 * only the enumeration still sees the right root and the right printed text.
 */

/** What a chord symbol decomposes into. `null` when it does not start on a note letter. */
export type ParsedChordSymbol = {
  /** A–G. */
  step: string;
  /** -1 for flat, 1 for sharp, 0 for neither. */
  alter: number;
  /** Everything after the root, e.g. `maj7` or `-7/Bb`. May be empty. */
  quality: string;
};

const ROOT = /^([A-G])([#b♯♭]?)(.*)$/;

export function parseChordSymbol(symbol: string): ParsedChordSymbol | null {
  const match = ROOT.exec(symbol.trim());
  if (!match) return null;

  const [, step, accidental, quality] = match;
  return {
    step,
    alter:
      accidental === '#' || accidental === '♯'
        ? 1
        : accidental === 'b' || accidental === '♭'
          ? -1
          : 0,
    quality: quality.trim(),
  };
}
