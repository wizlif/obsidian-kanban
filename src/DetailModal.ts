import { App, Component, MarkdownRenderer, Modal } from 'obsidian';
import { WorkItem, resolveWorkItem, stateTone, typeGlyph } from './workitem';

/** Jira-style issue detail: description on the left, fields on the right. */
export class WorkItemDetailModal extends Modal {
    private item: WorkItem;
    private children: WorkItem[];
    private sourcePath: string;
    private owner: Component;

    constructor(app: App, item: WorkItem, children: WorkItem[], sourcePath: string, owner: Component) {
        super(app);
        this.item = item;
        this.children = children;
        this.sourcePath = sourcePath;
        this.owner = owner;
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        modalEl.addClass('kanban-detail-modal');
        contentEl.empty();

        this.renderBreadcrumb(contentEl);

        const body = contentEl.createDiv({ cls: 'kanban-detail-body' });
        const main = body.createDiv({ cls: 'kanban-detail-main' });
        const side = body.createDiv({ cls: 'kanban-detail-side' });

        main.createEl('h1', { cls: 'kanban-detail-title', text: this.item.title });
        this.renderActions(main);
        void this.renderDescription(main);
        this.renderChildren(main);
        this.renderDetails(side);
    }

    private renderBreadcrumb(parent: HTMLElement) {
        const bar = parent.createDiv({ cls: 'kanban-detail-breadcrumb' });
        if (this.item.parent) {
            bar.createSpan({ cls: 'kanban-detail-crumb is-parent', text: `⚡ ${this.item.parent}` });
            bar.createSpan({ cls: 'kanban-detail-crumb-sep', text: '/' });
        }
        bar.createSpan({
            cls: 'kanban-detail-crumb',
            text: `${typeGlyph(this.item.type)} ${this.item.id}`,
        });
    }

    private renderActions(parent: HTMLElement) {
        const row = parent.createDiv({ cls: 'kanban-detail-actions' });
        if (this.item.file) {
            const open = row.createEl('button', { cls: 'kanban-detail-btn', text: 'Open note' });
            open.addEventListener('click', () => {
                this.close();
                void this.app.workspace.openLinkText(this.item.link, this.sourcePath, true);
            });
        }
        if (this.item.azure) {
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Azure DevOps" is a product name
            const az = row.createEl('button', { cls: 'kanban-detail-btn', text: 'Open in Azure DevOps' });
            az.addEventListener('click', () => window.open(this.item.azure));
        }
    }

    private async renderDescription(parent: HTMLElement) {
        parent.createDiv({ cls: 'kanban-detail-section-label', text: 'Description' });
        const box = parent.createDiv({ cls: 'kanban-detail-description' });
        const file = this.item.file;
        if (!file) {
            box.createEl('em', { text: 'No linked note.' });
            return;
        }
        const raw = await this.app.vault.cachedRead(file);
        const body = stripFrontmatterAndHeader(raw);
        if (!body.trim()) {
            box.createEl('em', { text: 'No description recorded on this work item.' });
            return;
        }
        await MarkdownRenderer.render(this.app, body, box, file.path, this.owner);
    }

    private renderChildren(parent: HTMLElement) {
        if (!this.children.length) return;
        parent.createDiv({
            cls: 'kanban-detail-section-label',
            text: `Linked work items (${this.children.length})`,
        });
        const list = parent.createDiv({ cls: 'kanban-detail-children' });
        for (const c of this.children) {
            const row = list.createDiv({ cls: 'kanban-detail-child' });
            row.createSpan({ cls: 'kanban-wi-glyph', text: typeGlyph(c.type) });
            row.createSpan({ cls: 'kanban-wi-key', text: c.id });
            row.createSpan({ cls: 'kanban-wi-title', text: c.title });
            if (c.state) {
                row.createSpan({
                    cls: `kanban-wi-state is-${stateTone(c.state)}`,
                    text: c.state,
                });
            }
            row.createSpan({
                cls: c.initials ? 'kanban-wi-avatar' : 'kanban-wi-avatar is-empty',
                text: c.initials,
                attr: { 'aria-label': c.assignee || 'Unassigned' },
            });
            row.addEventListener('click', () => {
                // Replace this modal with the child's, so drilling down stays in the popup.
                this.close();
                new WorkItemDetailModal(this.app, c, [], this.sourcePath, this.owner).open();
            });
        }
    }

    private renderDetails(parent: HTMLElement) {
        parent.createDiv({ cls: 'kanban-detail-section-label', text: 'Details' });
        const table = parent.createDiv({ cls: 'kanban-detail-fields' });
        const rows: [string, string][] = [
            ['Assignee', this.item.assignee],
            ['State', this.item.state],
            ['Type', this.item.type],
            ['Sprint', this.item.sprint],
            ['Area', this.item.area],
            ['Epic', this.item.epic],
            ['Story points', this.item.points],
            ['Labels', this.item.labels.join(', ')],
            ['Parent', this.item.parent],
        ];
        for (const [label, value] of rows) {
            const row = table.createDiv({ cls: 'kanban-detail-field' });
            row.createSpan({ cls: 'kanban-detail-field-key', text: label });
            const val = row.createSpan({ cls: 'kanban-detail-field-value' });
            if (!value) {
                val.addClass('is-empty');
                val.setText('None');
            } else if (label === 'Assignee') {
                val.createSpan({ cls: 'kanban-wi-avatar', text: this.item.initials });
                val.createSpan({ text: value });
            } else if (label === 'Labels') {
                for (const l of this.item.labels) {
                    val.createSpan({ cls: 'kanban-chip', text: l });
                }
            } else if (label === 'State') {
                val.createSpan({ cls: `kanban-wi-state is-${stateTone(value)}`, text: value });
            } else {
                val.setText(value);
            }
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

/** Drop YAML frontmatter, the generated H1 and the Azure link line. */
function stripFrontmatterAndHeader(raw: string): string {
    let t = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
    t = t.replace(/^#\s.*\n/, '');
    t = t.replace(/^\[Open in Azure DevOps\]\([^)]*\)\n/m, '');
    return t.trim();
}

export function collectChildren(app: App, raw: string[], sourcePath: string): WorkItem[] {
    return raw
        .map((r) => resolveWorkItem(app, r, sourcePath))
        .filter((w): w is WorkItem => w !== null);
}
