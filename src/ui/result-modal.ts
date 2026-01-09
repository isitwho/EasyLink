import { App, Editor, FuzzySuggestModal, FuzzyMatch, MarkdownRenderer, Notice, TFile, Component } from "obsidian";
import { SearchResult } from "../types";
import type EasyLinkPlugin from "../../main";

export class AdvancedResultModal extends FuzzySuggestModal<SearchResult> {
    private highlightRegex: RegExp | null = null;

    constructor(
        app: App,
        private plugin: EasyLinkPlugin,
        private results: SearchResult[],
        private editor: Editor,
        private originalSelection: string,
        private queryWords: Set<string>
    ) {
        super(app);
        if (this.queryWords.size > 0) {
            this.highlightRegex = new RegExp(
                `(${Array.from(this.queryWords).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("|")})`,
                "gi"
            );
        }
    }

    onOpen() {
        super.onOpen();
        this.modalEl.addClass("easylink-preview-modal");

        const hintEl = this.modalEl.createDiv({ cls: "easylink-shortcut-hint" });
        hintEl.innerHTML = "Press <b>↵ Enter</b> to insert link, or <b>Ctrl/Cmd + ↵ Enter</b> to open in a new tab.";

        this.scope.register(["Mod"], "Enter", () => {
            // @ts-ignore
            const selectedItem = this.results[this.chooser.selectedItem];
            if (selectedItem) {
                this.openNoteInNewTab(selectedItem);
                this.close();
            }
            return false;
        });
    }

    getItems(): SearchResult[] {
        return this.results;
    }

    getItemText(item: SearchResult): string {
        return `${item.file.basename} ${item.content}`;
    }

    renderSuggestion(match: FuzzyMatch<SearchResult>, el: HTMLElement): void {
        el.empty();
        el.addClass("easylink-result-item");

        const headerEl = el.createDiv({ cls: "easylink-result-header" });
        const titleEl = headerEl.createDiv({ cls: "easylink-result-title" });

        if (match.item.file.parent && !match.item.file.parent.isRoot()) {
            titleEl.createSpan({
                text: match.item.file.parent.name + " / ",
                cls: "easylink-folder-path",
            });
        }
        titleEl.createSpan({
            text: match.item.file.basename,
            cls: "easylink-file-name",
        });

        const scoreBadge = headerEl.createSpan({
            text: `${(match.item.score * 100).toFixed(0)}%`,
            cls: "easylink-result-score",
        });

        const score = match.item.score;
        if (score >= 0.9) scoreBadge.addClass("score-high");
        else if (score >= 0.7) scoreBadge.addClass("score-medium");
        else if (score < 0.5) scoreBadge.addClass("score-low");

        let contentToRender = match.item.content;
        if (this.highlightRegex) {
            contentToRender = contentToRender.replace(this.highlightRegex, "<mark>$1</mark>");
        }

        const previewEl = el.createDiv({ cls: "easylink-result-preview" });
        MarkdownRenderer.render(
            this.app,
            contentToRender,
            previewEl,
            match.item.file.path,
            this.plugin
        );
    }

    async onChooseItem(item: SearchResult, evt: MouseEvent | KeyboardEvent): Promise<void> {
        if (evt.ctrlKey || evt.metaKey) {
            await this.openNoteInNewTab(item);
        } else {
            await this.insertLink(item);
        }
    }

    private generateBlockId(): string {
        return Math.random().toString(36).substring(2, 8);
    }

    private async ensureAndGetBlockId(item: SearchResult): Promise<string> {
        if (item.linkTarget?.startsWith("^")) return item.linkTarget;

        const newBlockId = this.generateBlockId();
        const blockIdText = ` ^${newBlockId}`;

        const fileContent = await this.app.vault.read(item.file);
        const lines = fileContent.split("\n");
        const targetLineIndex = item.position!.end.line;
        const lastLine = lines[targetLineIndex];

        const insertPos = { line: targetLineIndex, ch: lastLine.length };
        const activeFile = this.app.workspace.getActiveFile();

        if (activeFile?.path === item.file.path) {
            const activeEditor = this.app.workspace.activeEditor?.editor;
            if (activeEditor) {
                activeEditor.replaceRange(blockIdText, insertPos);
                return `^${newBlockId}`;
            }
        }

        await this.app.vault.process(item.file, (data) => {
            const dataLines = data.split("\n");
            dataLines[targetLineIndex] += blockIdText;
            return dataLines.join("\n");
        });

        return `^${newBlockId}`;
    }

    private async buildLinkPath(item: SearchResult): Promise<string> {
        const filePath = this.app.metadataCache.fileToLinktext(item.file, "", true);
        let linkTarget = item.linkTarget;

        if (item.type === "block" && !linkTarget) {
            linkTarget = await this.ensureAndGetBlockId(item);
        }

        return linkTarget ? `${filePath}#${linkTarget}` : filePath;
    }

    async insertLink(item: SearchResult) {
        const linkPath = await this.buildLinkPath(item);
        const linkText = `[[${linkPath}|${this.originalSelection}]]`;
        this.editor.replaceSelection(linkText);
        new Notice(`Link to "${item.file.basename}" inserted.`);
    }

    async openNoteInNewTab(item: SearchResult) {
        const linkPath = await this.buildLinkPath(item);
        this.app.workspace.openLinkText(linkPath, item.file.path, true);
        new Notice(`Opened "${item.file.basename}" in a new tab.`);
    }
}
