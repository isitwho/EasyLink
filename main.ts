import {
	App,
	Editor,
	Notice,
	Plugin,
	TFile,
	FuzzySuggestModal,
	FuzzyMatch,
	PluginSettingTab,
	Setting,
	MarkdownRenderer,
	Pos,
	normalizePath,
} from "obsidian";

// --- 기본 설정 및 데이터 구조 ---
const EN_STOPWORDS = new Set([
	"i", "me", "my", "myself", "we", "our", "ours", "he", "him", "his", "she", "her", "it", "its", "they", "them", "their", "what", "which", "who", "this", "that", "these", "those", "am", "is", "are", "was", "were", "be", "been", "a", "an", "the", "and", "but", "if", "or", "as", "of", "at", "by", "for", "with", "to", "from", "in", "out", "on", "off",
]);
const KO_STOPWORDS = new Set([
	"이", "가", "은", "는", "을", "를", "의", "에", "에서", "와", "과", "도", "으로", "로", "만", "뿐", "그리고", "그래서", "그러나", "하지만", "그", "저", "것", "수", "때", "곳", "들", "명",
]);
const DEFAULT_STOPWORDS = new Set([...EN_STOPWORDS, ...KO_STOPWORDS]);

interface EasyLinkSettings {
	foldersToIgnore: string[];
	maxResults: number;
	minScore: number;
	useDefaultStopwords: boolean;
	customStopwords: string[];
	searchCurrentFile: boolean;
}

const DEFAULT_SETTINGS: EasyLinkSettings = {
	foldersToIgnore: [],
	maxResults: 25,
	minScore: 0.1,
	useDefaultStopwords: true,
	customStopwords: [],
	searchCurrentFile: false,
};

interface SearchResult {
	file: TFile;
	content: string;
	score: number;
	type: "heading" | "block";
	linkTarget: string;
	position?: Pos;
}

// --- 메인 플러그인 클래스 ---
export default class EasyLinkPlugin extends Plugin {
	settings: EasyLinkSettings;
	private isSearching = false;
	private combinedStopwords: Set<string>;

	async onload() {
		await this.loadSettings();
		this.updateStopwords();
		this.addRibbonIcon("link", "EasyLink: Find similar notes", () =>
			this.triggerSearch()
		);
		this.addCommand({
			id: "find-similar-content",
			name: "Find similar content for selection",
			editorCallback: (editor) => this.triggerSearch(editor),
		});
		this.addSettingTab(new EasyLinkSettingTab(this.app, this));
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				if (editor.getSelection()) {
					menu.addItem((item) => {
						item.setTitle("EasyLink: Find similar content")
							.setIcon("link")
							.onClick(() => this.triggerSearch(editor));
					});
				}
			})
		);
	}

	triggerSearch(editor?: Editor) {
		const activeEditor = editor || this.app.workspace.activeEditor?.editor;
		if (activeEditor) {
			const selectedText = activeEditor.getSelection();
			if (selectedText.trim() !== "") {
				this.findAndShowSimilarContent(selectedText, activeEditor);
			} else {
				new Notice("Please select text to find similar notes.");
			}
		} else {
			new Notice("Please open a note and select text first.");
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.updateStopwords();
	}

	updateStopwords() {
		const custom = new Set(this.settings.customStopwords.map(w => w.toLowerCase()));
		this.combinedStopwords = this.settings.useDefaultStopwords
			? new Set([...DEFAULT_STOPWORDS, ...custom])
			: custom;
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async findAndShowSimilarContent(query: string, editor: Editor) {
		if (this.isSearching) {
			new Notice("A search is already in progress.");
			return;
		}
		this.isSearching = true;

		let notice: Notice | null = null;
		const noticeTimeout = setTimeout(() => {
			notice = new Notice(
				`EasyLink: Searching for "${query.trim()}"...`,
				0
			);
		}, 500);

		try {
			const cleanQuery = query.trim();
			if (cleanQuery.length < 1) {
				new Notice("Please select at least 1 character.");
				return;
			}

			const queryWords = new Set(
				cleanQuery.toLowerCase().split(/\s+/).filter(
					(word) => word.length > 0 && !this.combinedStopwords.has(word)
				)
			);

			if (queryWords.size === 0 && cleanQuery.length > 0) {
				new Notice("Query contains only common words. Please try a more specific query.");
				return;
			}

			const searchTerms = queryWords.size > 0 ? queryWords : new Set(cleanQuery.toLowerCase().split(/\s+/));

			const engine = new SearchEngine(this.app, this.settings, this.combinedStopwords);
			const results = await engine.performSearch(query, searchTerms);

			const filteredResults = results.filter((r) => r.score >= this.settings.minScore);

			if (filteredResults.length > 0) {
				new AdvancedResultModal(
					this.app,
					this,
					filteredResults,
					editor,
					query,
					searchTerms
				).open();
			} else {
				if (results.length > 0) {
					new Notice("Found results, but they were below your minimum score setting.");
				} else {
					new Notice("No similar content found.");
				}
			}
		} catch (error) {
			console.error("EasyLink Search Error:", error);
		} finally {
			clearTimeout(noticeTimeout);
			if (notice) (notice as Notice).hide();
			this.isSearching = false;
		}
	}
}

// --- 최적화된 검색 엔진 ---
class SearchEngine {
	constructor(private app: App, private settings: EasyLinkSettings, private stopwords: Set<string>) { }

	async performSearch(query: string, searchTerms: Set<string>): Promise<SearchResult[]> {
		const searchResults: SearchResult[] = [];
		const files = this.app.vault.getMarkdownFiles();
		const currentFile = this.app.workspace.getActiveFile();
		const foldersToIgnore = new Set(this.settings.foldersToIgnore.map(normalizePath));
		const queryTermsArray = Array.from(searchTerms);

		for (const file of files) {
			if (!this.settings.searchCurrentFile && currentFile && file.path === currentFile.path) continue;
			if (foldersToIgnore.size > 0 && Array.from(foldersToIgnore).some(f => normalizePath(file.path).startsWith(f))) continue;

			const fileCache = this.app.metadataCache.getFileCache(file);
			if (!fileCache) continue;

			let fileContent: string | null = null;
			const getFileContent = async () => {
				if (fileContent === null) fileContent = await this.app.vault.cachedRead(file);
				return fileContent;
			};

			const processContent = (text: string, type: "heading" | "block", linkTarget: string, originalMarkdown: string, position?: Pos) => {
				const contentWords = new Set(text.toLowerCase().split(/\s+/).filter(w => !this.stopwords.has(w)));
				let matchCount = 0;
				for (const term of queryTermsArray) {
					if (contentWords.has(term)) matchCount++;
				}
				if (matchCount > 0) {
					searchResults.push({
						file,
						content: originalMarkdown,
						score: matchCount / searchTerms.size,
						type,
						linkTarget,
						position,
					});
				}
			};

			if (fileCache.headings) {
				for (const h of fileCache.headings) {
					processContent(h.heading, "heading", h.heading, "#".repeat(h.level) + " " + h.heading);
				}
			}

			if (fileCache.sections) {
				const content = await getFileContent();
				for (const section of fileCache.sections) {
					if (section.type === "heading") continue;
					const sectionText = content.substring(section.position.start.offset, section.position.end.offset);
					if (sectionText.trim().length > 0) {
						let blockId: string | undefined;
						if (fileCache.blocks) {
							for (const id in fileCache.blocks) {
								if (fileCache.blocks[id].position.end.line === section.position.end.line) {
									blockId = id;
									break;
								}
							}
						}
						processContent(sectionText, "block", blockId ? `^${blockId}` : "", sectionText, blockId ? undefined : section.position);
					}
				}
			}
		}

		return searchResults
			.sort((a, b) => b.score - a.score)
			.filter((r, i, s) => i === s.findIndex(x => x.file.path === r.file.path && x.content === r.content))
			.slice(0, this.settings.maxResults);
	}
}

// --- 검색창 모달 ---
class AdvancedResultModal extends FuzzySuggestModal<SearchResult> {
	private highlightRegex: RegExp | null = null;
	private showHeadersOnly = false;
	private allResults: SearchResult[];

	constructor(
		app: App,
		private plugin: EasyLinkPlugin,
		private results: SearchResult[],
		private editor: Editor,
		private originalSelection: string,
		private queryWords: Set<string>
	) {
		super(app);
		this.allResults = results;
		if (this.queryWords.size > 0) {
			this.highlightRegex = new RegExp(`(${Array.from(this.queryWords).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
		}
	}

	onOpen() {
		super.onOpen();
		this.modalEl.addClass("easylink-preview-modal");

		// 헤더 전용 토글 버튼 추가
		const inputContainer = this.modalEl.querySelector(".prompt-input-container");
		if (inputContainer) {
			inputContainer.addClass("has-toggle");
			const toggleContainer = inputContainer.createDiv({ cls: "easylink-toggle-container" });
			toggleContainer.createSpan({ text: "Headers only", cls: "easylink-toggle-label" });

			const label = toggleContainer.createEl("label", { cls: "easylink-toggle-switch" });
			const input = label.createEl("input", { type: "checkbox" });
			label.createSpan({ cls: "easylink-slider" });

			input.addEventListener("change", (e) => {
				this.showHeadersOnly = (e.target as HTMLInputElement).checked;
				// @ts-ignore - Trigger internal update
				this.onInput();
			});
		}

		const hintEl = this.modalEl.createDiv({ cls: "easylink-shortcut-hint" });
		hintEl.innerHTML = "Press <b>↵ Enter</b> to insert link, or <b>Ctrl/Cmd + ↵ Enter</b> to open in a new tab.";

		this.scope.register(["Mod"], "Enter", () => {
			// @ts-ignore
			const item = this.results[this.chooser.selectedItem];
			if (item) { this.openNoteInNewTab(item); this.close(); }
			return false;
		});
	}

	getItems(): SearchResult[] {
		if (this.showHeadersOnly) {
			return this.allResults.filter(r => r.type === "heading");
		}
		return this.allResults;
	}

	getItemText(item: SearchResult): string { return `${item.file.basename} ${item.content}`; }

	renderSuggestion(match: FuzzyMatch<SearchResult>, el: HTMLElement): void {
		el.empty();
		el.addClass("easylink-result-item");

		const headerEl = el.createDiv({ cls: "easylink-result-header" });
		const titleEl = headerEl.createDiv({ cls: "easylink-result-title" });

		// H/P 타입 배지 추가
		const badge = titleEl.createSpan({ cls: "easylink-type-badge" });
		let badgeText = "P";
		if (match.item.type === "heading") {
			const levelMatch = match.item.content.match(/^(#+)\s/);
			badgeText = levelMatch ? `H${levelMatch[1].length}` : "H";
		}
		badge.setText(badgeText);
		badge.addClass(match.item.type === "heading" ? "type-heading" : "type-block");

		if (match.item.file.parent && !match.item.file.parent.isRoot()) {
			titleEl.createSpan({ text: match.item.file.parent.name + " / ", cls: "easylink-folder-path" });
		}
		titleEl.createSpan({ text: match.item.file.basename, cls: "easylink-file-name" });

		const scoreBadge = headerEl.createSpan({ text: `${(match.item.score * 100).toFixed(0)}%`, cls: "easylink-result-score" });
		if (match.item.score >= 0.9) scoreBadge.addClass("score-high");
		else if (match.item.score >= 0.7) scoreBadge.addClass("score-medium");
		else if (match.item.score < 0.5) scoreBadge.addClass("score-low");

		let contentToRender = match.item.content;
		if (this.highlightRegex) contentToRender = contentToRender.replace(this.highlightRegex, "<mark>$1</mark>");

		const previewEl = el.createDiv({ cls: "easylink-result-preview" });
		MarkdownRenderer.render(this.app, contentToRender, previewEl, match.item.file.path, this.plugin);
	}

	async onChooseItem(item: SearchResult, evt: MouseEvent | KeyboardEvent): Promise<void> {
		if (evt.ctrlKey || evt.metaKey) await this.openNoteInNewTab(item);
		else await this.insertLink(item);
	}

	private generateBlockId(): string { return Math.random().toString(36).substring(2, 8); }

	private async ensureAndGetBlockId(item: SearchResult): Promise<string> {
		if (item.linkTarget?.startsWith("^")) return item.linkTarget;
		const newBlockId = this.generateBlockId();
		const blockIdText = ` ^${newBlockId}`;
		const fileContent = await this.app.vault.read(item.file);
		const lines = fileContent.split("\n");
		const lastLine = lines[item.position!.end.line];
		const insertPos = { line: item.position!.end.line, ch: lastLine.length };

		if (this.app.workspace.getActiveFile()?.path === item.file.path) {
			const activeEditor = this.app.workspace.activeEditor?.editor;
			if (activeEditor) { activeEditor.replaceRange(blockIdText, insertPos); return `^${newBlockId}`; }
		}
		await this.app.vault.process(item.file, (data) => {
			const dataLines = data.split("\n");
			dataLines[item.position!.end.line] += blockIdText;
			return dataLines.join("\n");
		});
		return `^${newBlockId}`;
	}

	private async buildLinkPath(item: SearchResult): Promise<string> {
		const filePath = this.app.metadataCache.fileToLinktext(item.file, "", true);
		let linkTarget = item.linkTarget;
		if (item.type === "block" && !linkTarget) linkTarget = await this.ensureAndGetBlockId(item);
		return linkTarget ? `${filePath}#${linkTarget}` : filePath;
	}

	async insertLink(item: SearchResult) {
		const linkPath = await this.buildLinkPath(item);
		this.editor.replaceSelection(`[[${linkPath}|${this.originalSelection}]]`);
		new Notice(`Link to "${item.file.basename}" inserted.`);
	}

	async openNoteInNewTab(item: SearchResult) {
		const linkPath = await this.buildLinkPath(item);
		this.app.workspace.openLinkText(linkPath, item.file.path, true);
		new Notice(`Opened "${item.file.basename}" in a new tab.`);
	}
}

// --- 설정 탭 ---
class EasyLinkSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: EasyLinkPlugin) { super(app, plugin); }

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setHeading().setName("General");
		new Setting(containerEl).setName("Include current file in search").setDesc("If enabled, the currently active file will also be included in the search results.")
			.addToggle((t) => t.setValue(this.plugin.settings.searchCurrentFile).onChange(async (v) => { this.plugin.settings.searchCurrentFile = v; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName("Folders to ignore").setDesc('Prevent search in specific folders. Enter one folder path per line.')
			.addTextArea((t) => t.setPlaceholder("Templates/\nAttachments/").setValue(this.plugin.settings.foldersToIgnore.join("\n")).onChange(async (v) => { this.plugin.settings.foldersToIgnore = v.split("\n").map(p => p.trim()).filter(p => p.length > 0); await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName("Maximum results").setDesc("The maximum number of results to display.")
			.addSlider((s) => s.setLimits(5, 100, 5).setValue(this.plugin.settings.maxResults).setDynamicTooltip().onChange(async (v) => { this.plugin.settings.maxResults = v; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName("Minimum score threshold").setDesc("Filter out results below this score.")
			.addSlider((s) => s.setLimits(0, 100, 1).setValue(this.plugin.settings.minScore * 100).setDynamicTooltip().onChange(async (v) => { this.plugin.settings.minScore = v / 100; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setHeading().setName("Keyword Search");
		new Setting(containerEl).setName("Use default stopwords").setDesc("If enabled, common words will be ignored.")
			.addToggle((t) => t.setValue(this.plugin.settings.useDefaultStopwords).onChange(async (v) => { this.plugin.settings.useDefaultStopwords = v; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName("Custom stopwords").setDesc("Add your own words to ignore.")
			.addTextArea((t) => t.setPlaceholder("word1\nword2").setValue(this.plugin.settings.customStopwords.join("\n")).onChange(async (v) => { this.plugin.settings.customStopwords = v.split("\n").map(p => p.trim()).filter(p => p.length > 0); await this.plugin.saveSettings(); }));
		new Setting(containerEl).setHeading().setName("Support");
		new Setting(containerEl).setDesc("If you find EasyLink useful, please consider supporting its development!")
			.addButton((b) => { b.setButtonText("Sponsor on GitHub ❤️").onClick(() => window.open("https://github.com/sponsors/isitwho", "_blank")); b.buttonEl.addClass("easylink-github-sponsor-button"); })
			.addButton((b) => { b.setButtonText("Buy Me a Coffee ☕").onClick(() => window.open("https://buymeacoffee.com/isitwho", "_blank")); b.buttonEl.addClass("easylink-bmac-button"); });
	}
}
