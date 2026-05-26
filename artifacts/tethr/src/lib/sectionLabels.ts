import { SectionLabel } from '../types/audio';

export const SECTION_LABELS: { key: SectionLabel; short: string; full: string }[] = [
  { key: 'intro',     short: 'INT',  full: 'INTRO'     },
  { key: 'verse',     short: 'VRS',  full: 'VERSE'     },
  { key: 'pre',       short: 'PRE',  full: 'PRE'       },
  { key: 'chorus',    short: 'CHR',  full: 'CHORUS'    },
  { key: 'bridge',    short: 'BRG',  full: 'BRIDGE'    },
  { key: 'breakdown', short: 'BKD',  full: 'BREAKDOWN' },
  { key: 'outro',     short: 'OUT',  full: 'OUTRO'     },
];

export function getSectionShort(label: SectionLabel | undefined): string | null {
  if (!label) return null;
  return SECTION_LABELS.find(s => s.key === label)?.short ?? null;
}

export function getSectionFull(label: SectionLabel | undefined): string | null {
  if (!label) return null;
  return SECTION_LABELS.find(s => s.key === label)?.full ?? null;
}
