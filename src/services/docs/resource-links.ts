/**
 * Where to find music to open, grouped by which importer each source feeds.
 *
 * **Here rather than in an app because two of them show this page.** The useful
 * half of an entry is not the link but *which importer the file feeds*, and
 * that is a fact about this product rather than about a web page — the same
 * reasoning that puts `docs-content.ts` beside it. A forty-two entry list
 * transcribed into a second app is forty-two chances for the two to disagree
 * about what this app can open.
 *
 * Structure and URLs only: every description is an i18n key, so the prose lives
 * in each host's locale files and a Chinese reader gets Chinese. The library
 * holds no strings in any language.
 *
 * The site icons deliberately do **not** live here. They are files on disk in
 * each app, read through that platform's own asset pipeline — a Vite glob on
 * the web — and a library cannot hold a bundler's import.
 */
import type { ResourceGroup } from '@sudobility/music_types';

/**
 * Grouped by which importer the files feed, in the order a reader is likely to
 * want them: scores first (the format that carries the most music), then MIDI,
 * then the two formats this app supports and most editors do not.
 *
 * Chosen for being free, long-lived and directly usable here rather than for
 * being large — a site behind a paywall or an account wall answers the page's
 * question with "no". The Mod Archive is also where this app's own tracker
 * decoder fixtures came from, so its files are the ones the importer is tested
 * against.
 */
export const RESOURCE_GROUPS: readonly ResourceGroup[] = [
  {
    key: 'scores',
    links: [
      {
        key: 'musescore',
        name: 'MuseScore',
        url: 'https://musescore.com/sheetmusic',
      },
      {
        key: 'openscore',
        name: 'OpenScore',
        url: 'https://musescore.com/openscore',
      },
      { key: 'imslp', name: 'IMSLP', url: 'https://imslp.org/' },
      { key: 'cpdl', name: 'CPDL', url: 'https://www.cpdl.org/' },
      {
        key: 'mutopia',
        name: 'Mutopia Project',
        url: 'https://www.mutopiaproject.org/',
      },
      {
        key: 'musopenScores',
        name: 'Musopen Sheet Music',
        url: 'https://musopen.org/sheetmusic/',
      },
      {
        key: 'openGoldberg',
        name: 'Open Goldberg Variations',
        url: 'https://opengoldbergvariations.org/',
      },
      {
        key: 'musicxmlDirectory',
        name: 'MusicXML.com Directory',
        url: 'https://www.musicxml.com/music-in-musicxml/',
      },
    ],
  },
  {
    key: 'midi',
    links: [
      { key: 'bitmidi', name: 'BitMidi', url: 'https://bitmidi.com/' },
      { key: 'vgmusic', name: 'VGMusic', url: 'https://www.vgmusic.com/' },
      {
        key: 'kunstderfuge',
        name: 'Kunst der Fuge',
        url: 'https://www.kunstderfuge.com/',
      },
      {
        key: 'midiworld',
        name: 'MIDIWORLD',
        url: 'https://www.midiworld.com/',
      },
      {
        key: 'mfiles',
        name: 'mfiles',
        url: 'https://www.mfiles.co.uk/classical-midi.htm',
      },
      {
        key: 'classicalArchives',
        name: 'Classical Archives',
        url: 'https://www.classicalarchives.com/prs/free.html',
      },
      {
        key: 'theSession',
        name: 'The Session',
        url: 'https://thesession.org/',
      },
      { key: 'hymnary', name: 'Hymnary', url: 'https://hymnary.org/' },
      { key: 'midkar', name: 'MIDKAR', url: 'https://midkar.com/' },
    ],
  },
  {
    key: 'modules',
    links: [
      {
        key: 'modarchive',
        name: 'The Mod Archive',
        url: 'https://modarchive.org/',
      },
      { key: 'modland', name: 'Modland', url: 'https://modland.com/' },
      {
        key: 'amp',
        name: 'Amiga Music Preservation',
        url: 'https://amp.dascene.net/',
      },
      {
        key: 'sceneOrg',
        name: 'scene.org',
        url: 'https://files.scene.org/browse/music/',
      },
      {
        key: 'woolyss',
        name: 'Woolyss Tracking',
        url: 'https://woolyss.com/tracking-modules.php',
      },
      {
        key: 'archiveTrackers',
        name: 'Tracker Collection (Internet Archive)',
        url: 'https://archive.org/details/spacedrone-ultimate-mod-xm-it-s3m-collection',
      },
    ],
  },
  {
    key: 'audio',
    links: [
      {
        key: 'musopenAudio',
        name: 'Musopen Recordings',
        url: 'https://musopen.org/music/',
      },
      {
        key: 'freeMusicArchive',
        name: 'Free Music Archive',
        url: 'https://freemusicarchive.org/',
      },
      { key: 'freesound', name: 'Freesound', url: 'https://freesound.org/' },
      {
        key: 'archiveAudio',
        name: 'Internet Archive Audio',
        url: 'https://archive.org/details/audio',
      },
    ],
  },
  {
    key: 'datasets',
    links: [
      { key: 'pdmx', name: 'PDMX', url: 'https://zenodo.org/records/14648209' },
      {
        key: 'lakh',
        name: 'Lakh MIDI Dataset',
        url: 'https://colinraffel.com/projects/lmd/',
      },
      {
        key: 'maestro',
        name: 'MAESTRO',
        url: 'https://magenta.withgoogle.com/datasets/maestro',
      },
      {
        key: 'adlPiano',
        name: 'ADL Piano MIDI',
        url: 'https://github.com/lucasnfe/adl-piano-midi',
      },
      {
        key: 'museTrainer',
        name: 'MuseTrainer Library',
        url: 'https://github.com/musetrainer/library',
      },
      {
        key: 'womenComposers',
        name: 'Scores by Women Composers',
        url: 'https://github.com/cuthbertLab/womenComposers',
      },
    ],
  },
  {
    key: 'sound',
    links: [
      {
        key: 'freepats',
        name: 'FreePATS',
        url: 'https://freepats.zenvoid.org/',
      },
      {
        key: 'polyphone',
        name: 'Polyphone',
        url: 'https://www.polyphone.io/en/soundfonts',
      },
      {
        key: 'generalUser',
        name: 'GeneralUser GS',
        url: 'https://www.schristiancollins.com/generaluser.php',
      },
      {
        key: 'philharmonia',
        name: 'Philharmonia Sound Samples',
        url: 'https://philharmonia.co.uk/resources/sound-samples/',
      },
    ],
  },
  {
    key: 'reference',
    links: [
      {
        key: 'musicXmlSpec',
        name: 'MusicXML 4.0',
        url: 'https://www.w3.org/2021/06/musicxml40/',
      },
      {
        key: 'generalMidi',
        name: 'General MIDI',
        url: 'https://midi.org/general-midi',
      },
      {
        key: 'standardMidiFile',
        name: 'Standard MIDI Files',
        url: 'https://midi.org/standard-midi-files',
      },
      { key: 'openMpt', name: 'OpenMPT', url: 'https://openmpt.org/' },
      {
        key: 'verovio',
        name: 'Verovio Humdrum Viewer',
        url: 'https://verovio.humdrum.org/',
      },
    ],
  },
];

/**
 * The bare host, for the line under each name.
 *
 * Derived rather than stored so it cannot disagree with the href above it, and
 * `www.` is dropped because it distinguishes nothing — the reader is checking
 * which site they are about to be sent to, not which subdomain.
 */
export function hostOf(url: string): string {
  return new URL(url).host.replace(/^www\./, '');
}

/**
 * The stand-in when a site has no icon.
 *
 * One letter, not an abbreviation: "CPDL" shortened to "CP" reads as a broken
 * name, where a single initial reads as what it is — a placeholder.
 */
export function monogramFor(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}
