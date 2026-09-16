import { App, PluginSettingTab, Setting } from "obsidian";
import KanbanPlugin from "./main";
import { KanbanPriority } from "./types";
import { KanbanView } from "./view";

export interface KanbanSettings {
	defaultLanes: string[];
	defaultPriorities: KanbanPriority[];
	autoGroupByPriority: boolean;
	newCardInsertionMethod: 'append' | 'prepend';
	newLineTrigger: 'enter' | 'shift-enter';
	hideTagsInTitle: boolean;
	laneWidth: number;
	dateTrigger: string;
	dateFormat: string;
	linkDateToDailyNote: boolean;
	showRelativeDate: boolean;
	newNoteTemplate: string;
	showLinkedPageMetadata: boolean;
	showAddCardInHeader: boolean;
	appendArchiveDate: boolean;
	archiveDateFormat: string;
	archiveLinkedNotes: boolean;
	myName: string;
}

export const DEFAULT_SETTINGS: KanbanSettings = {
	defaultLanes: ['Backlog', 'Todo', 'In Progress', 'Done'],
	defaultPriorities: [
		{ name: 'P1', color: 'red' },
		{ name: 'P2', color: 'orange' },
		{ name: 'P3', color: 'yellow' },
		{ name: 'P4', color: 'blue' },
	],
	autoGroupByPriority: false,
	newCardInsertionMethod: 'append',
	newLineTrigger: 'shift-enter',
	hideTagsInTitle: false,
	laneWidth: 272,
	dateTrigger: '@today',
	dateFormat: 'YYYY-MM-DD',
	linkDateToDailyNote: false,
	showRelativeDate: true,
	newNoteTemplate: '',
	showLinkedPageMetadata: false,
	showAddCardInHeader: true,
	myName: '',
	appendArchiveDate: false,
	archiveDateFormat: 'YYYY-MM-DD',
	archiveLinkedNotes: false,
}

export class KanbanSettingTab extends PluginSettingTab {
	plugin: KanbanPlugin;

	constructor(app: App, plugin: KanbanPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Board appearance')
			.setHeading();

		new Setting(containerEl)
			.setName('My name')
			.setDesc('Your name, used when filtering a board by assignee. Compared with the assignee field of a linked note, case-insensitively. Initials also match.')
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- example is a person's name
				.setPlaceholder('Jane Doe')
				.setValue(this.plugin.settings.myName)
				.onChange(async (value) => {
					this.plugin.settings.myName = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default lanes')
			.setDesc('Default swim lanes for new kanban boards (one per line)')
			.addTextArea(text => text
				.setPlaceholder('Backlog\ntodo\nin progress\ndone')
				.setValue(this.plugin.settings.defaultLanes.join('\n'))
				.onChange(async (value) => {
					this.plugin.settings.defaultLanes = value.split('\n').filter(l => l.trim() !== '');
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default priorities')
			.setDesc('Default priorities for new kanban boards (one per line)')
			.addTextArea(text => text
				.setPlaceholder('High, red')
				.setValue(this.plugin.settings.defaultPriorities.map(p => `${p.name},${p.color}`).join('\n'))
				.onChange(async (value) => {
					this.plugin.settings.defaultPriorities = value.split('\n')
						.map(line => line.trim())
						.filter(line => line !== '')
						.map(line => {
							const parts = line.split(',');
							return {
								name: parts[0] ? parts[0].trim() : 'Unknown',
								color: parts[1] ? parts[1].trim() : '#888888'
							};
						});
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto group by priority')
			.setDesc('Automatically group cards by priority and prevent dropping into the wrong priority group')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoGroupByPriority)
				.onChange(async (value) => {
					this.plugin.settings.autoGroupByPriority = value;
					await this.plugin.saveSettings();
					this.refreshViews();
				}));

		new Setting(containerEl)
			.setName('Lane width')
			.setDesc('Enter a number to set the list width in pixels')
			.addText(text => {
				text.inputEl.type = 'number';
				text.setValue(this.plugin.settings.laneWidth.toString())
					.onChange(async (value) => {
						const width = parseInt(value, 10);
						if (!isNaN(width)) {
							this.plugin.settings.laneWidth = width;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName('Hide tags in card titles')
			.setDesc('Hide tags from the visual card display')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideTagsInTitle)
				.onChange(async (value) => {
					this.plugin.settings.hideTagsInTitle = value;
					await this.plugin.saveSettings();
					this.refreshViews();
				}));

		new Setting(containerEl)
			.setName('Show linked page metadata')
			.setDesc('Display frontmatter metadata from linked pages on the card')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showLinkedPageMetadata)
				.onChange(async (value) => {
					this.plugin.settings.showLinkedPageMetadata = value;
					await this.plugin.saveSettings();
					this.refreshViews();
				}));

		new Setting(containerEl)
			.setName('Add card button in header')
			.setDesc('Adds a button to the header for creating new cards')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showAddCardInHeader)
				.onChange(async (value) => {
					this.plugin.settings.showAddCardInHeader = value;
					await this.plugin.saveSettings();
					this.refreshViews();
				}));

		new Setting(containerEl)
			.setName('Card behavior')
			.setHeading();

		new Setting(containerEl)
			.setName('New card insertion method')
			.setDesc('Whether new cards are added to the beginning or end of the list')
			.addDropdown(dropdown => dropdown
				.addOption('append', 'Append')
				.addOption('prepend', 'Prepend')
				.setValue(this.plugin.settings.newCardInsertionMethod)
				.onChange(async (value: 'append' | 'prepend') => {
					this.plugin.settings.newCardInsertionMethod = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('New line trigger')
			.setDesc('Whether Enter or Shift+Enter creates a new line in a card')
			.addDropdown(dropdown => dropdown
				.addOption('shift-enter', 'Shift + Enter')
				.addOption('enter', 'Enter')
				.setValue(this.plugin.settings.newLineTrigger)
				.onChange(async (value: 'enter' | 'shift-enter') => {
					this.plugin.settings.newLineTrigger = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Date and time')
			.setHeading();

		new Setting(containerEl)
			.setName('Date trigger')
			.setDesc('When this is typed, it will trigger the date selector (example: @today)')
			.addText(text => text
				.setValue(this.plugin.settings.dateTrigger)
				.onChange(async (value) => {
					this.plugin.settings.dateTrigger = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Date format')
			.setDesc('Format used when displaying and storing dates')
			.addText(text => text
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async (value) => {
					this.plugin.settings.dateFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Link dates to daily notes')
			.setDesc('Render dates as links to daily notes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.linkDateToDailyNote)
				.onChange(async (value) => {
					this.plugin.settings.linkDateToDailyNote = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show relative date')
			.setDesc('Display dates as relative to today (e.g. "in 2 days")')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showRelativeDate)
				.onChange(async (value) => {
					this.plugin.settings.showRelativeDate = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Note creation')
			.setHeading();

		new Setting(containerEl)
			.setName('Note template')
			.setDesc('Template for new notes')
			.addText(text => text
				.setValue(this.plugin.settings.newNoteTemplate)
				.onChange(async (value) => {
					this.plugin.settings.newNoteTemplate = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Archiving')
			.setHeading();

		new Setting(containerEl)
			.setName('Append date and time to archived cards')
			.setDesc('Automatically append the current date and time when archiving a card')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.appendArchiveDate)
				.onChange(async (value) => {
					this.plugin.settings.appendArchiveDate = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Archive linked notes')
			.setDesc('Automatically move linked notes to an archive folder when archiving a card')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.archiveLinkedNotes)
				.onChange(async (value) => {
					this.plugin.settings.archiveLinkedNotes = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Archive date format')
			.setDesc('Format used when appending dates to archived cards')
			.addText(text => text
				.setValue(this.plugin.settings.archiveDateFormat)
				.onChange(async (value) => {
					this.plugin.settings.archiveDateFormat = value;
					await this.plugin.saveSettings();
				}));
	}

	private refreshViews() {
		this.app.workspace.getLeavesOfType('kanban-view').forEach(leaf => {
			if (leaf.view instanceof KanbanView) {
				leaf.view.render();
			}
		});
	}
}
