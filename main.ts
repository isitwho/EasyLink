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
	"i",
	"me",
	"my",
	"myself",
	"we",
	"our",
	"ours",
	"he",
	"him",
	"his",
	"she",
	"her",
	"it",
	"its",
	"they",
	"them",
	"their",
	"what",
	"which",
	"who",
	"this",
	"that",
	"these",
	"those",
	"am",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"a",
	"an",
	"the",
	"and",
	"but",
	"if",
	"or",
	"as",
	"of",
	"at",
	"by",
	"for",
	"with",
	"to",
	"from",
	"in",
	"out",
	"on",
	"off",
]);
const KO_STOPWORDS = new Set([
	"이",
	"가",
	"은",
	"는",
	"을",
	"를",
	"의",
	"에",
	"에서",
	"와",
	"과",
	"도",
	"으로",
	"로",
	"만",
	"뿐",
	"그리고",
	"그래서",
	"그러나",
	"하지만",
	"그",
	"저",
	"것",
	"수",
	"때",
	"곳",
	"들",
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
		const custom = new Set(this.settings.customStopwords);
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
				cleanQuery
					.toLowerCase()
					.split(/\s+/)
					.filter(
						(word) =>
							word.length > 0 && !this.combinedStopwords.has(word)
					)
			);

			if (queryWords.size === 0 && cleanQuery.length > 0) {
				new Notice(
					"Query contains only common words. Please try a more specific query."
				);
				return;
			}

			// 한 단어 검색 시 queryWords가 비어있더라도, 원본 쿼리를 기반으로 검색을 시도하도록 허용
			const searchTerms =
				queryWords.size > 0
					? queryWords
					: new Set(cleanQuery.toLowerCase().split(/\s+/));

			const results = await this.keywordSearch(query, searchTerms);

			const filteredResults = results.filter(
				(r) => r.score >= this.settings.minScore
			);
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
					new Notice(
						"Found results, but they were below your minimum score setting."
					);
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

	async keywordSearch(
		query: string,
		queryWords: Set<string>
	): Promise<SearchResult[]> {
		const searchResults: SearchResult[] = [];
		const files = this.app.vault.getMarkdownFiles();
		const currentFile = this.app.workspace.getActiveFile();
		const foldersToIgnore = new Set(
			this.settings.foldersToIgnore.map(normalizePath)
		);

		for (const file of files) {
			if (
				!this.settings.searchCurrentFile &&
				currentFile &&
				file.path === currentFile.path
			)
				continue;
			if (
				foldersToIgnore.size > 0 &&
				Array.from(foldersToIgnore).some((folder) =>
					normalizePath(file.path).startsWith(folder)
				)
			)
				continue;

			const fileCache = this.app.metadataCache.getFileCache(file);
			if (!fileCache) continue;
			const content = await this.app.vault.cachedRead(file);

			const processContent = (
				text: string,
				type: "heading" | "block",
				linkTarget: string,
				originalMarkdown: string,
				position?: Pos
			) => {
				const contentWords = new Set(
					text
						.toLowerCase()
						.split(/\s+/)
						.filter((word) => !this.combinedStopwords.has(word))
				);
				let matchCount = 0;
				for (const queryWord of queryWords) {
					if (contentWords.has(queryWord)) matchCount++;
				}
				if (matchCount > 0) {
					const score = matchCount / queryWords.size;
					searchResults.push({
						file,
						content: originalMarkdown,
						score,
						type,
						linkTarget,
						position,
					});
				}
			};

			if (fileCache.headings) {
				for (const h of fileCache.headings) {
					const markdownSource =
						"#".repeat(h.level) + " " + h.heading;
					processContent(
						h.heading,
						"heading",
						h.heading,
						markdownSource
					);
				}
			}
			if (fileCache.sections) {
				for (const section of fileCache.sections) {
					if (section.type === "heading") continue;
					const sectionText = content.substring(
						section.position.start.offset,
						section.position.end.offset
					);
					if (sectionText.trim().length > 0) {
						let blockId;
						if (fileCache.blocks) {
							for (const id in fileCache.blocks) {
								if (
									fileCache.blocks[id].position.end.line ===
									section.position.end.line
								) {
									blockId = id;
									break;
								}
							}
						}

						// 블록 ID가 있으면 linkTarget에 저장, 없으면 position을 저장
						processContent(
							sectionText,
							"block",
							blockId ? `^${blockId}` : "",
							sectionText,
							blockId ? undefined : section.position
						);
					}
				}
			}
		}

		searchResults.sort((a, b) => b.score - a.score);
		const uniqueResults = searchResults.filter(
			(result, index, self) =>
				index ===
				self.findIndex(
					(r) =>
						r.file.path === result.file.path &&
						r.content === result.content
				)
		);
		return uniqueResults.slice(0, this.settings.maxResults);
	}
}

// --- 검색창 모달 ---

class AdvancedResultModal extends FuzzySuggestModal<SearchResult> {
	constructor(
		app: App,
		private plugin: EasyLinkPlugin,
		private results: SearchResult[],
		private editor: Editor,
		private originalSelection: string,
		private queryWords: Set<string> // 하이라이팅을 위한 검색어
	) {
		super(app);
	}

	onOpen() {
		super.onOpen();
		this.modalEl.addClass("easylink-preview-modal");

		const hintEl = this.modalEl.createDiv({
			cls: "easylink-shortcut-hint",
		});
		hintEl.innerHTML =
			"Press <b>↵ Enter</b> to insert link, or <b>Ctrl/Cmd + ↵ Enter</b> to open in a new tab.";

		this.scope.register(["Mod"], "Enter", (evt) => {
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

		// 헤더
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

		// 하이라이팅 로직
		let contentToRender = match.item.content;
		if (this.queryWords.size > 0) {
			const regex = new RegExp(
				`(${Array.from(this.queryWords).join("|")})`,
				"gi"
			);
			contentToRender = contentToRender.replace(regex, "<mark>$1</mark>");
		}

		// 내용 미리보기
		const previewEl = el.createDiv({ cls: "easylink-result-preview" });
		MarkdownRenderer.render(
			this.app,
			contentToRender,
			previewEl,
			match.item.file.path,
			this.plugin
		);
	}

	async onChooseItem(
		item: SearchResult,
		evt: MouseEvent | KeyboardEvent
	): Promise<void> {
		if (evt.ctrlKey || evt.metaKey) {
			await this.openNoteInNewTab(item);
		} else {
			await this.insertLink(item);
		}
	}

	generateBlockId(): string {
		return Math.random().toString(36).substring(2, 8);
	}

	async ensureAndGetBlockId(item: SearchResult): Promise<string> {
		if (item.linkTarget && item.linkTarget.startsWith("^")) {
			return item.linkTarget; // 이미 ID가 있으면 그대로 반환
		}

		// ID가 없으면 새로 생성
		const newBlockId = this.generateBlockId();
		const blockIdText = ` ^${newBlockId}`;

		// 파일 끝에 공백 줄이 있는지 확인하고, 없다면 추가
		const fileContent = await this.app.vault.read(item.file);
		const lines = fileContent.split("\n");
		const lastLine = lines[item.position!.end.line];

		const insertPos = {
			line: item.position!.end.line,
			ch: lastLine.length,
		};

		const activeEditor = this.app.workspace.activeEditor?.editor;
		if (
			activeEditor &&
			activeEditor.getLine(0) === lines[0] &&
			this.app.workspace.getActiveFile()?.path === item.file.path
		) {
			activeEditor.replaceRange(blockIdText, insertPos);
		} else {
			await this.app.vault.process(item.file, (data) => {
				const lines = data.split("\n");
				lines[item.position!.end.line] += blockIdText;
				return lines.join("\n");
			});
		}

		return `^${newBlockId}`;
	}

	private async buildLinkPath(item: SearchResult): Promise<string> {
		const filePath = this.app.metadataCache.fileToLinktext(
			item.file,
			"",
			true
		);
		let linkTarget = item.linkTarget;

		if (item.type === "block" && !linkTarget) {
			linkTarget = await this.ensureAndGetBlockId(item);
		}

		if (linkTarget) {
			return `${filePath}#${linkTarget}`;
		}
		return filePath;
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

// --- 설정 탭 ---
class EasyLinkSettingTab extends PluginSettingTab {
	plugin: EasyLinkPlugin;

	constructor(app: App, plugin: EasyLinkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setHeading().setName("General");

		new Setting(containerEl)
			.setName("Include current file in search")
			.setDesc(
				"If enabled, the currently active file will also be included in the search results."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.searchCurrentFile)
					.onChange(async (value) => {
						this.plugin.settings.searchCurrentFile = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Folders to ignore")
			.setDesc(
				'Prevent search in specific folders. Enter one folder path per line (e.g., "Meta/Templates").'
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("Templates/\nAttachments/")
					.setValue(this.plugin.settings.foldersToIgnore.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.foldersToIgnore = value
							.split("\n")
							.map((p) => p.trim())
							.filter((p) => p.length > 0);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Maximum results")
			.setDesc(
				"The maximum number of results to display in the search modal."
			)
			.addSlider((slider) =>
				slider
					.setLimits(5, 100, 5)
					.setValue(this.plugin.settings.maxResults)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxResults = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Minimum score threshold")
			.setDesc(
				"Filter out results below this similarity score. A lower value will show more, less relevant results."
			)
			.addSlider((slider) =>
				slider
					.setLimits(0, 100, 1)
					.setValue(this.plugin.settings.minScore * 100)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.minScore = value / 100;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setHeading().setName("Keyword Search");

		new Setting(containerEl)
			.setName("Use default stopwords")
			.setDesc(
				'If enabled, common words (like "the", "it", "is", "and") will be ignored during search for better relevance.'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useDefaultStopwords)
					.onChange(async (value) => {
						this.plugin.settings.useDefaultStopwords = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Custom stopwords")
			.setDesc(
				"Add your own words to ignore during keyword search. Enter one word per line."
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("project-x\ninternal-memo\netc")
					.setValue(this.plugin.settings.customStopwords.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.customStopwords = value
							.split("\n")
							.map((p) => p.trim())
							.filter((p) => p.length > 0);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setHeading().setName("Support");
		new Setting(containerEl)
			.setDesc(
				"If you find EasyLink useful, please consider supporting its development!"
			)
			.addButton((btn) => {
				btn.setButtonText("Sponsor on GitHub ❤️").onClick(() => {
					window.open(
						"https://github.com/sponsors/isitwho",
						"_blank"
					);
				});
				btn.buttonEl.addClass("easylink-github-sponsor-button");
			})
			.addButton((btn) => {
				btn.setButtonText("Buy Me a Coffee ☕").onClick(() => {
					window.open("https://buymeacoffee.com/isitwho", "_blank");
				});
				btn.buttonEl.addClass("easylink-bmac-button");
			});
	}
}
