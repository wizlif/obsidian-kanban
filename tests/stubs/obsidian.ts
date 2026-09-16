/** Minimal stand-ins so parser.ts can run outside Obsidian. */
export function parseYaml(src: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    let key: string | null = null;
    for (const line of src.split('\n')) {
        if (!line.trim()) continue;
        const item = line.match(/^\s+-\s+(.*)$/);
        if (item && key) {
            (out[key] as string[]).push((item[1] ?? '').trim());
            continue;
        }
        const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (kv) {
            key = kv[1] ?? '';
            const val = (kv[2] ?? '').trim();
            out[key] = val === '' ? [] : val.replace(/^["']|["']$/g, '');
        }
    }
    return out;
}

export function stringifyYaml(obj: Record<string, unknown>): string {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) {
            lines.push(`${k}:`);
            for (const i of v) lines.push(`  - ${String(i)}`);
        } else {
            lines.push(`${k}: ${String(v)}`);
        }
    }
    return lines.join('\n') + '\n';
}
