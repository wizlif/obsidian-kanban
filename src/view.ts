import { TextFileView, WorkspaceLeaf, Menu, Modal, App, Setting, Notice, MarkdownRenderer, normalizePath, TFile, Component } from 'obsidian';
import { WorkItemDetailModal, collectChildren } from './DetailModal';
import { isAssignedTo, parseCard, resolveWorkItem, stateTone, typeGlyph } from './workitem';
import { KanbanBoard, moveCard, updateCard, duplicateCard, KanbanLane, KanbanCard } from './types';
import { MarkdownParser } from './parser';
import KanbanPlugin from './main';

export const KANBAN_VIEW_TYPE = 'kanban-view';

export class KanbanView extends TextFileView {
    plugin: KanbanPlugin;
    board: KanbanBoard | null = null;
    editingCardId: string | null = null;
    editingLaneId: string | null = null;
    isEditingTitle: boolean = false;
    filterText: string = "";
    assignedToMeOnly = false;
    private mineCache = new Map<string, boolean>();
    placeholderEl: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: KanbanPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.placeholderEl = document.createElement('div');
        this.placeholderEl.addClass('kanban-card-placeholder');
    }

    getViewType() {
        return KANBAN_VIEW_TYPE;
    }

    getDisplayText() {
        return this.file ? this.file.basename : 'Kanban board';
    }

    setViewData(data: string, clear: boolean) {
        this.board = MarkdownParser.parse(data);
        if (!this.board.settings) this.board.settings = {};
        if (!this.board.settings.dateTrigger) this.board.settings.dateTrigger = this.plugin.settings.dateTrigger;
        if (!this.board.settings.dateFormat) this.board.settings.dateFormat = this.plugin.settings.dateFormat;
        if (!this.board.settings.priorities && this.plugin.settings.defaultPriorities && this.plugin.settings.defaultPriorities.length > 0) {
            this.board.settings.priorities = [...this.plugin.settings.defaultPriorities];
        }
        
        if (clear) {
            this.editingCardId = null;
            this.editingLaneId = null;
            this.isEditingTitle = false;
        }
        this.render();
    }

    getViewData() {
        if (!this.board) return "";
        return MarkdownParser.stringify(this.board);
    }

    clear() {
        this.board = null;
        this.editingCardId = null;
        this.editingLaneId = null;
        this.isEditingTitle = false;
    }

    setBoard(board: KanbanBoard) {
        this.board = board;
        this.render();
    }

    async onOpen() { }

    private updateBoard(newBoard: KanbanBoard) {
        if (!newBoard.settings) newBoard.settings = {};
        if (!newBoard.settings.dateTrigger) newBoard.settings.dateTrigger = this.plugin.settings.dateTrigger;
        if (!newBoard.settings.dateFormat) newBoard.settings.dateFormat = this.plugin.settings.dateFormat;

        if (this.plugin.settings.autoGroupByPriority) {
            const sortLanesRecursively = (lanes: KanbanLane[]) => {
                for (const lane of lanes) {
                    lane.cards.sort((a, b) => this.getPriorityRank(a.priority) - this.getPriorityRank(b.priority));
                    if (lane.subLanes) {
                        sortLanesRecursively(lane.subLanes);
                    }
                }
            };
            sortLanesRecursively(newBoard.lanes);
        }
        
        this.board = newBoard;
        this.requestSave();
        this.render();
    }

    render() {
        // Frontmatter can change between renders; assignment is resolved fresh each time.
        this.mineCache.clear();
        const container = this.contentEl;
        container.empty();
        container.addClass('kanban-board-container');

        if (!this.board) {
            container.createEl('h2', { text: 'No board loaded' });
            return;
        }

        const boardEl = container.createDiv({ cls: 'kanban-board' });

        const headerEl = boardEl.createDiv({ cls: 'kanban-header' });

        const titleWrapper = headerEl.createDiv({ cls: 'kanban-title-wrapper' });
        if (this.isEditingTitle) {
            const titleInput = titleWrapper.createEl('input', {
                cls: 'kanban-title-input',
                value: this.board.title || this.file?.basename || ""
            });
            titleInput.focus();

            const saveTitle = () => {
                this.board!.title = titleInput.value;
                this.isEditingTitle = false;
                this.updateBoard({ ...this.board! });
            };

            titleInput.addEventListener('blur', saveTitle);
            titleInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') {
                    this.isEditingTitle = false;
                    this.render();
                }
            });
        } else {
            const titleEl = titleWrapper.createEl('h1', {
                text: this.board.title || this.file?.basename || "Untitled board",
                cls: 'kanban-title'
            });
            titleEl.addEventListener('click', () => {
                this.isEditingTitle = true;
                this.render();
            });
        }

        const controlsWrapper = headerEl.createDiv({ cls: 'kanban-controls-wrapper' });

        const searchInput = controlsWrapper.createEl('input', {
            cls: 'kanban-search-input',
            placeholder: 'Search cards',
            value: this.filterText
        });
        
        // Restore focus and cursor position if we were searching
        if (this.filterText) {
            searchInput.focus();
            searchInput.setSelectionRange(this.filterText.length, this.filterText.length);
        }

        searchInput.addEventListener('input', () => {
            const val = searchInput.value;
            this.filterText = val.toLowerCase();
            this.render();
            
            // Re-find the element after render and restore state
            const newSearchInput = this.contentEl.querySelector('.kanban-search-input') as HTMLInputElement;
            if (newSearchInput) {
                newSearchInput.focus();
                newSearchInput.setSelectionRange(val.length, val.length);
            }
        });

        const myName = this.plugin.settings.myName;
        const mineBtn = controlsWrapper.createDiv({
            cls: `kanban-mine-btn${this.assignedToMeOnly ? ' is-active' : ''}${myName ? '' : ' is-disabled'}`,
            attr: {
                title: myName
                    ? `Show only work assigned to ${myName}`
                    : 'Set your name in the plugin settings to use this filter',
            },
        });
        mineBtn.createSpan({ cls: 'kanban-mine-btn-dot' });
        mineBtn.createSpan({ text: 'Assigned to me' });
        mineBtn.addEventListener('click', () => {
            if (!this.plugin.settings.myName) {
                new Notice('Set your name in the plugin settings to filter by assignee.');
                return;
            }
            this.assignedToMeOnly = !this.assignedToMeOnly;
            this.render();
        });

        const archiveBtn = headerEl.createDiv({ cls: 'kanban-archive-btn', text: '📦', attr: { title: 'View archive' } });
        archiveBtn.addEventListener('click', () => {
            new ArchiveModal(this.app, this.board!).open();
        });

        const settingsBtn = headerEl.createDiv({ cls: 'kanban-settings-btn', text: '⚙' });
        settingsBtn.addEventListener('click', () => {
            new BoardSettingsModal(this.app, this.board!, (newBoard) => {
                this.updateBoard(newBoard);
            }).open();
        });

        const lanesContainer = boardEl.createDiv({ cls: 'kanban-lanes' });

        for (const lane of this.board.lanes) {
            this.renderLane(lane, lanesContainer, 2);
        }
    }

    private renderLane(lane: KanbanLane, parentEl: HTMLElement, depth: number) {
        if (lane.title === '*** Archive ***') return;

        const laneEl = parentEl.createDiv({ cls: `kanban-lane depth-${depth}` });
        if (this.plugin.settings.laneWidth && depth === 2) {
            laneEl.setCssProps({
                '--lane-width': `${this.plugin.settings.laneWidth}px`
            });
        }
        laneEl.dataset.laneId = lane.id;

        // Drag and drop listeners on the lane element itself
        laneEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            laneEl.addClass('kanban-lane-drag-over');

            const cardsContainer = Array.from(laneEl.children).find(child => child.classList.contains('kanban-cards')) as HTMLElement;
            if (cardsContainer) {
                const afterElement = this.getDragAfterElement(cardsContainer, e.clientY);
                if (afterElement == null) {
                    cardsContainer.appendChild(this.placeholderEl);
                } else {
                    cardsContainer.insertBefore(this.placeholderEl, afterElement);
                }
            }
        });

        laneEl.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            const relatedTarget = e.relatedTarget as Node | null;
            if (relatedTarget && laneEl.contains(relatedTarget)) return;
            laneEl.removeClass('kanban-lane-drag-over');
        });

        laneEl.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            laneEl.removeClass('kanban-lane-drag-over');

            if (this.placeholderEl && this.placeholderEl.parentNode) {
                this.placeholderEl.parentNode.removeChild(this.placeholderEl);
            }

            const cardId = e.dataTransfer?.getData('text/plain');
            if (cardId && this.board) {
                const cardsContainer = Array.from(laneEl.children).find(child => child.classList.contains('kanban-cards')) as HTMLElement;
                if (!cardsContainer) return;
                
                const afterElement = this.getDragAfterElement(cardsContainer, e.clientY);
                const index = afterElement == null
                    ? lane.cards.length
                    : parseInt(afterElement.dataset.index || "0");

                const newBoard = moveCard({ ...this.board }, cardId, lane.id, index);
                
                if (this.plugin.settings.autoGroupByPriority) {
                    const targetLane = this.findLaneRecursively(newBoard.lanes, lane.id);
                    if (targetLane) {
                        let isSorted = true;
                        for (let i = 0; i < targetLane.cards.length - 1; i++) {
                            const cardA = targetLane.cards[i];
                            const cardB = targetLane.cards[i+1];
                            if (cardA && cardB) {
                                const rankA = this.getPriorityRank(cardA.priority);
                                const rankB = this.getPriorityRank(cardB.priority);
                                if (rankA > rankB) {
                                    isSorted = false;
                                    break;
                                }
                            }
                        }
                        if (!isSorted) {
                            new Notice("Cannot move card to a different priority group");
                            return; // Abort the move
                        }
                    }
                }

                this.updateBoard(newBoard);
            }
        });

        const laneHeader = laneEl.createDiv({ cls: 'kanban-lane-header' });

        if (this.editingLaneId === lane.id) {
            const laneInput = laneHeader.createEl('input', {
                cls: 'kanban-lane-title-input',
                value: lane.title
            });
            laneInput.focus();

            const saveLane = () => {
                lane.title = laneInput.value;
                this.editingLaneId = null;
                this.updateBoard({ ...this.board! });
            };

            laneInput.addEventListener('blur', saveLane);
            laneInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') saveLane();
                if (e.key === 'Escape') {
                    this.editingLaneId = null;
                    this.render();
                }
            });
        } else {
            const titleEl = laneHeader.createDiv({ text: lane.title, cls: 'kanban-lane-title' });
            titleEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.editingLaneId = lane.id;
                this.render();
            });

            const rightSideHeader = laneHeader.createDiv({ cls: 'kanban-lane-header-right' });

            if (this.plugin.settings.showAddCardInHeader) {
                const addIcon = rightSideHeader.createDiv({ cls: 'kanban-lane-add-icon', text: '+' });
                addIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.board) {
                        const newCard = {
                            id: Math.random().toString(36).substring(2, 11),
                            content: ""
                        };
                        if (this.plugin.settings.newCardInsertionMethod === 'prepend') {
                            lane.cards.unshift(newCard);
                        } else {
                            lane.cards.push(newCard);
                        }
                        this.editingCardId = newCard.id;
                        this.updateBoard({ ...this.board });
                    }
                });
            }

            const menuBtn = rightSideHeader.createDiv({ cls: 'kanban-lane-menu-btn', text: '⋮' });
            menuBtn.addEventListener('click', (e) => {
                const menu = new Menu();
                menu.addItem((item) =>
                    item.setTitle("Delete lane")
                        .setIcon("trash")
                        .setDisabled(lane.cards.length > 0 || (lane.subLanes?.length || 0) > 0)
                        .onClick(() => {
                            if (lane.cards.length > 0 || (lane.subLanes?.length || 0) > 0) {
                                new Notice("Cannot delete a lane that contains cards or sub-lanes.");
                                return;
                            }
                            if (this.board) {
                                const removeLaneRecursively = (lanes: KanbanLane[]): KanbanLane[] => {
                                    return lanes.filter(l => {
                                        if (l.id === lane.id) return false;
                                        if (l.subLanes) l.subLanes = removeLaneRecursively(l.subLanes);
                                        return true;
                                    });
                                };
                                this.board.lanes = removeLaneRecursively(this.board.lanes);
                                this.updateBoard({ ...this.board });
                            }
                        })
                );
                if (lane.cards.length > 0 || (lane.subLanes?.length || 0) > 0) {
                    menu.addItem((item) => item.setTitle("Only empty lanes can be deleted").setDisabled(true));
                }
                menu.showAtMouseEvent(e);
            });

            const wipMatch = lane.title.match(/\((\d+)\)$/);
            const wipLimit = wipMatch && wipMatch[1] ? parseInt(wipMatch[1], 10) : null;
            const isOverLimit = wipLimit !== null && lane.cards.length > wipLimit;

            const countEl = rightSideHeader.createDiv({ cls: 'kanban-lane-count' });
            countEl.createSpan({ text: lane.cards.length.toString(), cls: isOverLimit ? 'kanban-wip-over' : '' });
            if (wipLimit !== null) {
                countEl.createSpan({ text: ` / ${wipLimit}` });
            }
        }

        const cardsContainer = laneEl.createDiv({ cls: 'kanban-cards' });

        const isDoneLane = lane.title.toLowerCase() === 'done';

        lane.cards.forEach((card, index) => {
            // Apply search filter
            if (this.filterText && !card.content.toLowerCase().includes(this.filterText)) {
                return;
            }

            if (this.assignedToMeOnly && !this.isCardMine(card)) {
                return;
            }

            const isEditing = this.editingCardId === card.id;
            const cardEl = cardsContainer.createDiv({ cls: `kanban-card ${isEditing ? 'kanban-card-editing' : ''} ${isDoneLane ? 'is-completed' : ''}` });
            cardEl.draggable = !isEditing;
            cardEl.dataset.cardId = card.id;
            cardEl.dataset.laneId = lane.id;
            cardEl.dataset.index = index.toString();

            if (!isEditing) {
                cardEl.addEventListener('dragstart', (e) => {
                    e.stopPropagation();
                    if (e.dataTransfer) {
                        e.dataTransfer.setData('text/plain', card.id);
                        e.dataTransfer.effectAllowed = 'move';
                    }
                    cardEl.addClass('kanban-card-dragging');
                });

                cardEl.addEventListener('dragend', (e) => {
                    e.stopPropagation();
                    cardEl.removeClass('kanban-card-dragging');
                    if (this.placeholderEl && this.placeholderEl.parentNode) {
                        this.placeholderEl.parentNode.removeChild(this.placeholderEl);
                    }
                });

                cardEl.addEventListener('contextmenu', (e: MouseEvent) => {
                    e.preventDefault();
                    const menu = new Menu();

                    // Group 1: Edit & New Note
                    menu.addItem((item) => {
                        item.setIcon("lucide-edit")
                            .setTitle("Edit card")
                            .onClick(() => {
                                this.editingCardId = card.id;
                                this.render();
                            });
                    });

                    menu.addItem((item) => {
                        item.setIcon("lucide-file-plus-2")
                            .setTitle("New note from card")
                            .onClick(async () => {
                                await this.createNoteFromCard(card, lane);
                            });
                    });

                    menu.addSeparator();

                    // Group 2: Priority
                    if (this.board?.settings?.priorities && this.board.settings.priorities.length > 0) {
                        const priorities = this.board.settings.priorities;
                        
                        menu.addItem((item) => {
                            item.setIcon("lucide-flag")
                                .setTitle("Set priority");
                                
                            const submenu = (item as unknown as { setSubmenu: () => Menu }).setSubmenu();
                            
                            if (card.priority) {
                                submenu.addItem((subItem) => {
                                    subItem.setTitle("Clear priority")
                                        .setIcon("lucide-x")
                                        .onClick(() => {
                                            if (this.board) {
                                                card.priority = undefined;
                                                this.updateBoard({ ...this.board });
                                            }
                                        });
                                });
                                submenu.addSeparator();
                            }
                            
                            priorities.forEach(p => {
                                submenu.addItem((subItem) => {
                                    subItem.setTitle(p.name)
                                        .setChecked(card.priority === p.name)
                                        .onClick(() => {
                                            if (this.board) {
                                                card.priority = p.name;
                                                this.updateBoard({ ...this.board });
                                            }
                                        });
                                    
                                    const iconEl = (subItem as unknown as { iconEl: HTMLElement | undefined }).iconEl;
                                    if (iconEl) {
                                        iconEl.empty();
                                        iconEl.createDiv({ attr: { style: `width: 12px; height: 12px; border-radius: 50%; background-color: ${p.color};` } });
                                    }
                                });
                            });
                        });
                        menu.addSeparator();
                    }

                    // Group 3: Duplicate, Archive, Delete
                    menu.addItem((item) => {
                        item.setIcon("lucide-copy")
                            .setTitle("Duplicate card")
                            .onClick(() => {
                                if (this.board) {
                                    this.updateBoard(duplicateCard({ ...this.board }, card.id));
                                }
                            });
                    });

                    menu.addItem((item) => {
                        item.setIcon("lucide-archive")
                            .setTitle("Archive card")
                            .onClick(async () => {
                                if (this.board) {
                                    let archiveLane = this.board.lanes.find(l => l.title === '*** Archive ***');
                                    if (!archiveLane) {
                                        archiveLane = { id: Math.random().toString(36).substring(2, 11), title: '*** Archive ***', cards: [] };
                                        this.board.lanes.push(archiveLane);
                                    }

                                    // Archive linked notes if setting is enabled
                                    const file = this.file;
                                    if (this.plugin.settings.archiveLinkedNotes && file) {
                                        const filePath = file.path;
                                        const parentPath = file.parent ? file.parent.path : "";
                                        const linkRegex = /\[\[([^\]|]+)(?:\|.*)?\]\]/g;
                                        let match;
                                        
                                        // Format for prepending: YYYY-MM-DD - 
                                        const archiveDateFormat = this.plugin.settings.archiveDateFormat || 'YYYY-MM-DD';
                                        const datePrefix = card.date || window.moment().format(archiveDateFormat);
                                        
                                        while ((match = linkRegex.exec(card.content)) !== null) {
                                            const linkText = match[1];
                                            if (!linkText) continue;
                                            const destFile = this.app.metadataCache.getFirstLinkpathDest(linkText, filePath);
                                            if (destFile && destFile instanceof TFile) {
                                                const archiveFolderPath = normalizePath(`${parentPath}/archive`);
                                                
                                                // Ensure archive folder exists
                                                if (!this.app.vault.getAbstractFileByPath(archiveFolderPath)) {
                                                    await this.app.vault.createFolder(archiveFolderPath);
                                                }

                                                const newFileName = `${datePrefix} - ${destFile.name}`;
                                                const newPath = normalizePath(`${archiveFolderPath}/${newFileName}`);
                                                
                                                // Check if already archived/exists
                                                if (!this.app.vault.getAbstractFileByPath(newPath)) {
                                                    const oldLink = match[0];
                                                    await this.app.fileManager.renameFile(destFile, newPath);
                                                    
                                                    // Update the card content with the new link
                                                    const newLinkName = newFileName.replace(/\.md$/, '');
                                                    const newLink = `[[${newLinkName}]]`;
                                                    card.content = card.content.replace(oldLink, newLink);
                                                }
                                            }
                                        }
                                    }

                                    let updatedBoard = moveCard({ ...this.board }, card.id, archiveLane.id, archiveLane.cards.length);
                                    let finalContent = card.content;
                                    if (this.plugin.settings.appendArchiveDate) {
                                        const format = this.plugin.settings.archiveDateFormat || 'YYYY-MM-DD';
                                        finalContent += ` ${window.moment().format(format)}`;
                                    }
                                    updatedBoard = updateCard(updatedBoard, card.id, finalContent);
                                    this.updateBoard(updatedBoard);
                                }
                            });
                    });

                    menu.addItem((item) => {
                        item.setIcon("lucide-trash-2")
                            .setTitle("Delete card")
                            .onClick(() => {
                                if (this.board) {
                                    const removeCardRecursively = (lanes: KanbanLane[]) => {
                                        for (const l of lanes) {
                                            l.cards = l.cards.filter(c => c.id !== card.id);
                                            if (l.subLanes) removeCardRecursively(l.subLanes);
                                        }
                                    };
                                    removeCardRecursively(this.board.lanes);
                                    this.updateBoard({ ...this.board });
                                }
                            });
                    });

                    menu.addSeparator();

                    // Group 3: Add Date
                    const isToday = card.date === window.moment().format('YYYY-MM-DD');
                    if (!isToday) {
                        menu.addItem((item) => {
                            item.setIcon("lucide-calendar-check")
                                .setTitle(card.date ? "Switch to today" : "Add today")
                                .onClick(() => {
                                    if (this.board) {
                                        card.date = window.moment().format('YYYY-MM-DD');
                                        this.updateBoard({ ...this.board });
                                        new Notice("Date set to today: " + card.date);
                                    }
                                });
                        });
                    }

                    menu.addItem((item) => {
                        item.setIcon("lucide-calendar-days")
                            .setTitle(card.date ? "Change date" : "Add date")
                            .onClick(() => {
                                this.showDatePicker(card);
                            });
                    });

                    if (card.date) {
                        menu.addItem((item) => {
                            item.setIcon("lucide-calendar-x")
                                .setTitle("Remove date")
                                .onClick(() => {
                                    if (this.board) {
                                        card.date = undefined;
                                        this.updateBoard({ ...this.board });
                                        new Notice("Date removed");
                                    }
                                });
                        });
                    }

                    menu.showAtMouseEvent(e);
                });

                cardEl.addEventListener('click', (e: MouseEvent) => {
                    const target = e.target as HTMLElement;
                    
                    // Handle links
                    const anchor = target.closest('a');
                    if (anchor) {
                        const href = anchor.getAttr('data-href') || anchor.getAttr('href');
                        if (href) {
                            if (anchor.hasClass('internal-link')) {
                                void this.app.workspace.openLinkText(href, this.file?.path || "", e.ctrlKey || e.metaKey || e.button === 1);
                            } else if (anchor.hasClass('external-link')) {
                                window.open(href);
                            }
                        }
                        return;
                    }

                    // If we're clicking a checkbox, don't enter edit mode
                    if (target.closest('.task-list-item-checkbox') || target.closest('input[type="checkbox"]')) {
                        return;
                    }

                    this.editingCardId = card.id;
                    this.render();
                });
            }

            if (isEditing) {
                const textarea = cardEl.createEl('textarea', {
                    cls: 'kanban-card-textarea',
                    text: card.content
                });

                textarea.focus();

                const save = () => {
                    if (this.board) {
                        let valueToSave = textarea.value.trim();

                        if (!valueToSave) {
                            const removeCardRecursively = (lanes: KanbanLane[]) => {
                                for (const l of lanes) {
                                    l.cards = l.cards.filter(c => c.id !== card.id);
                                    if (l.subLanes) removeCardRecursively(l.subLanes);
                                }
                            };
                            removeCardRecursively(this.board.lanes);
                            this.editingCardId = null;
                            this.updateBoard({ ...this.board });
                            return;
                        }

                        // Date Replacements
                        const df = this.plugin.settings.dateFormat || 'YYYY-MM-DD';

                        if (valueToSave.includes('@today')) {
                            valueToSave = valueToSave.replace(/@today/g, window.moment().format(df));
                        }

                        if (valueToSave.includes('@tomorrow')) {
                            valueToSave = valueToSave.replace(/@tomorrow/g, window.moment().add(1, 'day').format(df));
                        }

                        const customTrigger = this.plugin.settings.dateTrigger;
                        if (customTrigger && customTrigger !== '@today' && customTrigger !== '@tomorrow' && valueToSave.includes(customTrigger)) {
                            const escapeRegex = (s: string) => s.replace(/[\\^$*+?.()|[\]{}-]/g, '\\$&');
                            const triggerRegex = new RegExp(escapeRegex(customTrigger), 'g');
                            valueToSave = valueToSave.replace(triggerRegex, window.moment().format(df));
                        }

                        const newBoard = updateCard({ ...this.board }, card.id, valueToSave);
                        this.editingCardId = null;
                        this.updateBoard(newBoard);
                    }
                };

                textarea.addEventListener('blur', save);
                textarea.addEventListener('keydown', (e) => {
                    const trigger = this.plugin.settings.newLineTrigger || 'shift-enter';
                    const isSave = trigger === 'shift-enter' ? (e.key === 'Enter' && !e.shiftKey) : (e.key === 'Enter' && e.shiftKey);

                    if (isSave) {
                        e.preventDefault();
                        textarea.blur();
                    } else if (e.key === 'Escape') {
                        if (!textarea.value.trim() && !card.content.trim() && this.board) {
                            const removeCardRecursively = (lanes: KanbanLane[]) => {
                                for (const l of lanes) {
                                    l.cards = l.cards.filter(c => c.id !== card.id);
                                    if (l.subLanes) removeCardRecursively(l.subLanes);
                                }
                            };
                            removeCardRecursively(this.board.lanes);
                            this.editingCardId = null;
                            this.updateBoard({ ...this.board });
                        } else {
                            this.editingCardId = null;
                            this.render();
                        }
                    }
                });
            } else {
                let displayContent = card.content;

                if (this.plugin.settings.hideTagsInTitle) {
                    displayContent = displayContent.replace(/#[^\s#]+/g, '').replace(/\s{2,}/g, ' ').trim();
                }

                const sourcePath = this.file?.path || "";
                const parsed = parseCard(displayContent);
                const primary = resolveWorkItem(this.app, parsed.primary, sourcePath);

                if (primary && primary.file) {
                    const children = collectChildren(this.app, parsed.children, sourcePath);
                    cardEl.addClass('kanban-card-jira');
                    this.renderJiraCard(cardEl, primary, children, sourcePath);
                } else {
                    const contentContainer = cardEl.createDiv({ cls: 'kanban-card-content kanban-card-native-checkboxes' });
                    void MarkdownRenderer.render(this.app, displayContent, contentContainer, sourcePath, this);
                }
            }
        });

        if (lane.subLanes && lane.subLanes.length > 0) {
            const subLanesContainer = laneEl.createDiv({ cls: 'kanban-sub-lanes' });
            for (const subLane of lane.subLanes) {
                this.renderLane(subLane, subLanesContainer, depth + 1);
            }
        }

        if (!this.plugin.settings.showAddCardInHeader) {
            const addCardBtn = laneEl.createDiv({ cls: 'kanban-add-card', text: '+ Add a card' });
            addCardBtn.addEventListener('click', () => {
                if (this.board) {
                    const newCard = {
                        id: Math.random().toString(36).substring(2, 11),
                        content: ""
                    };
                    if (this.plugin.settings.newCardInsertionMethod === 'prepend') {
                        lane.cards.unshift(newCard);
                    } else {
                        lane.cards.push(newCard);
                    }
                    this.editingCardId = newCard.id;
                    this.updateBoard({ ...this.board });
                }
            });
        }
    }

    /** True when a card's story or any of its work items is assigned to the configured name. */
    private isCardMine(card: KanbanCard): boolean {
        const me = this.plugin.settings.myName;
        if (!me) return true;

        const cached = this.mineCache.get(card.id);
        if (cached !== undefined) return cached;

        const sourcePath = this.file?.path || "";
        const parsed = parseCard(card.content);
        const primary = resolveWorkItem(this.app, parsed.primary, sourcePath);
        const children = collectChildren(this.app, parsed.children, sourcePath);
        const mine = isAssignedTo(me, primary, children);

        this.mineCache.set(card.id, mine);
        return mine;
    }

    /** Jira-style card: title, epic chip, labels, work items, footer. */
    private renderJiraCard(cardEl: HTMLElement, item: import('./workitem').WorkItem,
                           children: import('./workitem').WorkItem[], sourcePath: string) {
        if (item.epic) {
            cardEl.createDiv({ cls: 'kanban-jira-epic' }).createSpan({ text: item.epic });
        }

        cardEl.createDiv({ cls: 'kanban-jira-title', text: item.title });

        if (item.labels.length) {
            const labels = cardEl.createDiv({ cls: 'kanban-jira-labels' });
            for (const l of item.labels.slice(0, 4)) {
                labels.createSpan({ cls: 'kanban-chip', text: l });
            }
            if (item.labels.length > 4) {
                labels.createSpan({ cls: 'kanban-chip is-more', text: `+${item.labels.length - 4}` });
            }
        }

        if (children.length) {
            const done = children.filter((c) => stateTone(c.state) === 'done').length;
            const wrap = cardEl.createDiv({ cls: 'kanban-jira-workitems' });
            const head = wrap.createDiv({ cls: 'kanban-jira-workitems-head' });
            head.createSpan({ cls: 'kanban-jira-wi-caret', text: '▾' });
            head.createSpan({ text: `Work items ${done}/${children.length}` });
            if (this.assignedToMeOnly) {
                const mineCount = children.filter(
                    (c) => isAssignedTo(this.plugin.settings.myName, c, [])
                ).length;
                if (mineCount) {
                    head.createSpan({ cls: 'kanban-jira-wi-mine-count', text: `${mineCount} mine` });
                }
            }

            const list = wrap.createDiv({ cls: 'kanban-jira-wi-list' });
            const draw = () => {
                list.empty();
                for (const c of children) {
                    const isMine = isAssignedTo(this.plugin.settings.myName, c, []);
                    const row = list.createDiv({
                        cls: `kanban-jira-wi${this.assignedToMeOnly && isMine ? ' is-mine' : ''}`,
                    });
                    row.createSpan({ cls: 'kanban-wi-glyph', text: typeGlyph(c.type) });
                    row.createSpan({ cls: 'kanban-wi-key', text: c.id });
                    row.createSpan({ cls: 'kanban-wi-title', text: c.title });
                    if (c.state) {
                        row.createSpan({ cls: `kanban-wi-state is-${stateTone(c.state)}`, text: c.state });
                    }
                    row.createSpan({
                        cls: c.initials ? 'kanban-wi-avatar' : 'kanban-wi-avatar is-empty',
                        text: c.initials,
                        attr: { 'aria-label': c.assignee || 'Unassigned' },
                    });
                    row.addEventListener('click', (e) => {
                        e.stopPropagation();
                        void this.app.workspace.openLinkText(c.link, sourcePath, true);
                    });
                }
            };
            draw();

            head.addEventListener('click', (e) => {
                e.stopPropagation();
                const collapsed = wrap.hasClass('is-collapsed');
                wrap.toggleClass('is-collapsed', !collapsed);
                head.firstElementChild?.setText(collapsed ? '▾' : '▸');
            });
        }

        const foot = cardEl.createDiv({ cls: 'kanban-jira-foot' });
        foot.createSpan({ cls: `kanban-wi-glyph is-${item.type.toLowerCase()}`, text: typeGlyph(item.type) });
        foot.createSpan({ cls: 'kanban-wi-key', text: item.id });
        if (item.state) {
            foot.createSpan({ cls: `kanban-wi-state is-${stateTone(item.state)}`, text: item.state });
        }
        const right = foot.createDiv({ cls: 'kanban-jira-foot-right' });
        if (item.points) right.createSpan({ cls: 'kanban-jira-points', text: item.points });
        right.createSpan({
            cls: item.initials ? 'kanban-wi-avatar' : 'kanban-wi-avatar is-empty',
            text: item.initials,
            attr: { 'aria-label': item.assignee || 'Unassigned' },
        });

        cardEl.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.kanban-jira-wi') || target.closest('.kanban-jira-workitems-head')) return;
            e.stopPropagation();
            new WorkItemDetailModal(this.app, item, children, sourcePath, this).open();
        }, true);
    }

    private getPriorityRank(priorityName?: string): number {
        if (!priorityName) return 0; // No priority always at the top
        const priorities = this.board?.settings?.priorities || [];
        const index = priorities.findIndex(p => p.name === priorityName);
        return index === -1 ? 0 : index + 1; // 1-based index to be greater than no-priority
    }

    public enforcePriorityGrouping() {
        if (!this.board || !this.plugin.settings.autoGroupByPriority) return;
        this.updateBoard({ ...this.board });
    }

    private findLaneRecursively(lanes: KanbanLane[], laneId: string): KanbanLane | undefined {
        for (const lane of lanes) {
            if (lane.id === laneId) return lane;
            if (lane.subLanes) {
                const found = this.findLaneRecursively(lane.subLanes, laneId);
                if (found) return found;
            }
        }
        return undefined;
    }

    private getContrastYIQ(color: string) {        // Native web platform trick to convert any valid CSS color name to hex
        const ctx = document.createElement('canvas').getContext('2d');
        if (ctx) {
            ctx.fillStyle = color;
            color = ctx.fillStyle; // this natively converts 'red' to '#ff0000'
        }

        let hexcolor = color.replace("#", "");
        
        // Handle potential rgb/rgba returns (though fillStyle usually returns hex)
        if (hexcolor.startsWith('rgb')) {
            const match = hexcolor.match(/\d+/g);
            if (match && match.length >= 3 && match[0] && match[1] && match[2]) {
                const r = parseInt(match[0], 10);
                const g = parseInt(match[1], 10);
                const b = parseInt(match[2], 10);
                const yiq = ((r*299)+(g*587)+(b*114))/1000;
                return (yiq >= 128) ? 'black' : 'white';
            }
        }

        if (hexcolor.length === 3) {
            hexcolor = hexcolor.substring(0, 1) + hexcolor.substring(0, 1) + 
                       hexcolor.substring(1, 2) + hexcolor.substring(1, 2) + 
                       hexcolor.substring(2, 3) + hexcolor.substring(2, 3);
        }
        
        const r = parseInt(hexcolor.substring(0,2),16) || 0;
        const g = parseInt(hexcolor.substring(2,4),16) || 0;
        const b = parseInt(hexcolor.substring(4,6),16) || 0;
        const yiq = ((r*299)+(g*587)+(b*114))/1000;
        return (yiq >= 128) ? 'black' : 'white';
    }

    private getDragAfterElement(container: HTMLElement, y: number): HTMLElement | null {
        const draggableElements = [...container.querySelectorAll('.kanban-card:not(.kanban-card-dragging)')] as HTMLElement[];

        return draggableElements.reduce<{ offset: number; element: HTMLElement | null }>((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
    }

    private async createNoteFromCard(card: KanbanCard, lane: KanbanLane) {
        let noteTitle = (card.content.split('\n')[0] || "").replace(/[\\/:"*?<>|#]/g, '').trim() || `Card ${card.id}`;
        if (noteTitle.length > 50) noteTitle = noteTitle.substring(0, 50).trim();

        const folderPath = this.file?.parent?.path || "";
        const templatePath = this.plugin.settings.newNoteTemplate || "";

        let folder = this.app.vault.getAbstractFileByPath(folderPath || '/');
        if (!folder && folderPath) {
            try {
                folder = await this.app.vault.createFolder(folderPath);
            } catch {
                new Notice("Failed to create folder: " + folderPath);
                return;
            }
        }

        const fullPath = normalizePath(`${folderPath && folderPath !== '/' ? folderPath + '/' : ''}${noteTitle}.md`);

        // check if exists
        let file = this.app.vault.getAbstractFileByPath(fullPath);
        if (file && file instanceof TFile) {
            new Notice("File already exists: " + fullPath);
            await this.app.workspace.getLeaf(false).openFile(file);
            return;
        }

        let content = "";
        if (templatePath) {
            try {
                const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
                if (templateFile && templateFile instanceof TFile) {
                    content = await this.app.vault.read(templateFile);
                }
            } catch {
                new Notice("Failed to read template file: " + templatePath);
            }
        } else {
            // Use the first line as the filename/title, and only include subsequent lines in the note body
            const lines = card.content.split('\n');
            content = lines.slice(1).join('\n');
            if (content.length > 0) {
                content += '\n';
            }
        }

        try {
            const newFile = await this.app.vault.create(fullPath, content);
            new Notice(`Created note: ${noteTitle}`);

            if (this.board) {
                const newContent = `[[${noteTitle}]]`;
                this.updateBoard(updateCard({ ...this.board }, card.id, newContent));
            }

            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.openFile(newFile, { state: { mode: 'source' } });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            new Notice("Failed to create note: " + message);
        }
    }

    private showDatePicker(card: KanbanCard) {
        const modal = new Modal(this.app);
        modal.titleEl.setText("Select date");
        
        const container = modal.contentEl.createDiv({ cls: 'kanban-date-modal' });
        const input = container.createEl('input', { 
            type: 'date', 
            value: card.date || "" 
        });

        const buttonContainer = modal.contentEl.createDiv({ cls: 'kanban-date-modal-buttons' });

        const saveBtn = buttonContainer.createEl('button', { 
            text: 'Save', 
            cls: 'mod-cta' 
        });
        
        saveBtn.addEventListener('click', () => {
            if (input.value && this.board) {
                card.date = input.value;
                this.updateBoard({ ...this.board });
                new Notice("Date updated to: " + input.value);
                modal.close();
            } else if (!input.value && this.board) {
                card.date = undefined;
                this.updateBoard({ ...this.board });
                modal.close();
            }
        });

        const cancelBtn = buttonContainer.createEl('button', { 
            text: 'Cancel'
        });
        cancelBtn.addEventListener('click', () => modal.close());

        modal.open();
        input.focus();
    }
}

class BoardSettingsModal extends Modal {
    board: KanbanBoard;
    onSave: (board: KanbanBoard) => void;

    constructor(app: App, board: KanbanBoard, onSave: (board: KanbanBoard) => void) {
        super(app);
        this.board = board;
        this.onSave = onSave;
    }

    private findLaneByTitleRecursively(lanes: KanbanLane[], title: string): KanbanLane | undefined {
        for (const l of lanes) {
            if (l.title === title) return l;
            if (l.subLanes) {
                const found = this.findLaneByTitleRecursively(l.subLanes, title);
                if (found) return found;
            }
        }
        return undefined;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        new Setting(contentEl)
            .setName('Board settings')
            .setHeading();

        new Setting(contentEl)
            .setName('Swim lanes')
            .setDesc('Configure the lanes for this board (one per line). Use "- " prefix for sub-lanes.')
            .addTextArea(text => {
                const serializeLanes = (lanes: KanbanLane[]): string[] => {
                    const res: string[] = [];
                    for (const l of lanes) {
                        if (l.title === '*** Archive ***') continue;
                        res.push(l.title);
                        if (l.subLanes) {
                            l.subLanes.forEach(sub => res.push(`- ${sub.title}`));
                        }
                    }
                    return res;
                };

                text.setPlaceholder('Backlog\ntodo\nin progress\n- active\n- slow\ndone')
                    .setValue(serializeLanes(this.board.lanes).join('\n'))
                    .onChange((value) => {
                        const lines = value.split('\n').filter(t => t.trim() !== '');
                        const newTitles = lines.map(line => {
                            const trimmed = line.trim();
                            return trimmed.startsWith('- ') ? trimmed.substring(2).trim() : trimmed;
                        });

                        const newLanes: KanbanLane[] = [];
                        let currentParent: KanbanLane | null = null;

                        lines.forEach(line => {
                            const trimmed = line.trim();
                            const isSub = trimmed.startsWith('- ');
                            const title = isSub ? trimmed.substring(2).trim() : trimmed;

                            const existing = this.findLaneByTitleRecursively(this.board.lanes, title);
                            const lane: KanbanLane = existing ? { ...existing, subLanes: [] } : {
                                id: Math.random().toString(36).substring(2, 11),
                                title,
                                cards: [],
                                subLanes: []
                            };

                            if (!isSub) {
                                newLanes.push(lane);
                                currentParent = lane;
                            } else if (currentParent) {
                                if (!currentParent.subLanes) currentParent.subLanes = [];
                                currentParent.subLanes.push(lane);
                            } else {
                                newLanes.push(lane);
                                currentParent = lane;
                            }
                        });

                        // Prevent data loss: retain any lanes (including sub-lanes) that have cards but were removed from the settings
                        const getAllLanesFlat = (lanes: KanbanLane[]): KanbanLane[] => {
                            let res: KanbanLane[] = [];
                            for (const l of lanes) {
                                res.push(l);
                                if (l.subLanes) res = res.concat(getAllLanesFlat(l.subLanes));
                            }
                            return res;
                        };

                        const originalLanesFlat = getAllLanesFlat(this.board.lanes);
                        const removedWithCards = originalLanesFlat.filter(l => 
                            l.title !== '*** Archive ***' && 
                            !newTitles.includes(l.title) && 
                            l.cards.length > 0
                        );

                        removedWithCards.forEach(lane => {
                            // Only add if not already in newLanes (checking by ID or title)
                            if (!this.findLaneByTitleRecursively(newLanes, lane.title)) {
                                newLanes.push({ ...lane, subLanes: [] });
                            }
                        });

                        // Keep archive lane
                        const archiveLane = this.board.lanes.find(l => l.title === '*** Archive ***');
                        if (archiveLane) newLanes.push(archiveLane);

                        this.board.lanes = newLanes;
                    });
                text.inputEl.rows = 8;
                text.inputEl.addClass('kanban-settings-textarea');
            });

        new Setting(contentEl)
            .setName('Priorities')
            .setDesc('Configure the priorities for this board (one per line)')
            .addTextArea(text => {
                const prioritiesStr = (this.board.settings?.priorities || []).map(p => `${p.name},${p.color}`).join('\n');
                text.setPlaceholder('High, red')
                    .setValue(prioritiesStr)
                    .onChange((value) => {
                        if (!this.board.settings) this.board.settings = {};
                        
                        const lines = value.split('\n').map(l => l.trim()).filter(l => l !== '');
                        if (lines.length === 0) {
                            this.board.settings.priorities = undefined;
                        } else {
                            this.board.settings.priorities = lines.map(line => {
                                const parts = line.split(',');
                                return {
                                    name: parts[0] ? parts[0].trim() : 'Unknown',
                                    color: parts[1] ? parts[1].trim() : '#888888'
                                };
                            });
                        }
                    });
                text.inputEl.rows = 4;
                text.inputEl.addClass('kanban-settings-textarea');
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    this.onSave(this.board);
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class ArchiveModal extends Modal {
    board: KanbanBoard;

    constructor(app: App, board: KanbanBoard) {
        super(app);
        this.board = board;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        new Setting(contentEl)
            .setName('Archived cards')
            .setHeading();

        const archiveLane = this.board.lanes.find(l => l.title === '*** Archive ***');
        if (!archiveLane || archiveLane.cards.length === 0) {
            contentEl.createEl('p', { text: 'No archived cards.' });
            return;
        }

        const list = contentEl.createEl('ul', { cls: 'kanban-archive-list' });
        archiveLane.cards.forEach(card => {
            const li = list.createEl('li', { cls: 'kanban-archive-item' });
            void MarkdownRenderer.render(this.app, card.content, li, "", this as unknown as Component);
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
