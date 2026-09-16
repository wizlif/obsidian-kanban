import { App, TFile } from 'obsidian';

/** A work item resolved from a wikilink to its note's frontmatter. */
export interface WorkItem {
    link: string;
    file: TFile | null;
    id: string;
    title: string;
    type: string;
    state: string;
    epic: string;
    labels: string[];
    assignee: string;
    initials: string;
    points: string;
    sprint: string;
    area: string;
    parent: string;
    azure: string;
}

const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/;

function str(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
}

export function resolveWorkItem(app: App, raw: string, sourcePath: string): WorkItem | null {
    const m = raw.match(WIKILINK);
    if (!m) return null;
    const link = (m[1] ?? '').trim();
    const alias = (m[2] ?? '').trim();
    const file = app.metadataCache.getFirstLinkpathDest(link, sourcePath);
    const fm = (file && app.metadataCache.getFileCache(file)?.frontmatter) || {};

    const labels = str(fm.labels)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    return {
        link,
        file,
        id: str(fm.id) || link,
        title: str(fm.title) || alias || link,
        type: str(fm.type) || 'Story',
        state: str(fm.state),
        epic: str(fm.epic),
        labels,
        assignee: str(fm.assignee),
        initials: str(fm.initials),
        points: str(fm.points),
        sprint: str(fm.sprint),
        area: str(fm.area),
        parent: str(fm.parent),
        azure: str(fm.azure),
    };
}

/** Split a card's markdown into its primary item and the nested work items. */
export function parseCard(content: string): { primary: string; children: string[] } {
    // The board parser dedents continuation lines, so indentation cannot identify
    // children. The first non-empty line is the story; every later one is a work item.
    const children: string[] = [];
    let primary = '';
    for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        const stripped = line
            .replace(/^\s*[-*+]\s+/, '')
            .replace(/^\[[ xX/]\]\s*/, '')
            .trim();
        if (!stripped) continue;
        if (!primary) primary = stripped;
        else children.push(stripped);
    }
    if (!primary) primary = content.trim();
    return { primary, children };
}

/** Colour family for a state pill. Unknown states fall back to neutral. */
export function stateTone(state: string): string {
    const s = state.toLowerCase();
    if (s === 'closed' || s === 'done' || s === 'resolved') return 'done';
    if (s === 'active' || s === 'in progress' || s === 'committed') return 'progress';
    if (s === 'new' || s === 'proposed' || s === 'to do') return 'todo';
    if (s === 'design') return 'design';
    return 'neutral';
}

export function typeGlyph(type: string): string {
    const t = type.toLowerCase();
    if (t === 'bug') return '◆';
    if (t === 'task') return '✓';
    if (t === 'epic') return '⚡';
    if (t === 'feature') return '◈';
    return '▢';
}
