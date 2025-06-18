import { App, Editor, MarkdownView, Notice, Plugin, TFile, FuzzySuggestModal, FuzzyMatch, Vault, MetadataCache, PluginSettingTab, Setting } from 'obsidian';

const EN_STOPWORDS = new Set(['is', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now']);
const KO_STOPWORDS = new Set(['는', '을', '를', '에서', '으로', '뿐', '그리고', '그래서', '그러나', '하지만', '그런데', '등', '및', '저', '것', '때', '곳']);

const STOPWORDS = new Set([...EN_STOPWORDS, ...KO_STOPWORDS]);

interface SimilarNotesSettings {
	foldersToIgnore: string[];
	maxResults: number;
	minScore: number;
}

const DEFAULT_SETTINGS: SimilarNotesSettings = {
	foldersToIgnore: [],
	maxResults: 25,
	minScore: 0.1, // 10% 유사도
}

// 검색 결과를 담을 데이터 구조 정의 (score 속성 포함)
interface SimilarContentResult {
	file: TFile;
	content: string; 
	displayText: string;
	type: 'heading' | 'block';
	linkTarget: string; // 링크 생성 시 사용될 #헤딩 또는 ^블록ID
	score: number; // 검색 결과의 유사도 점수
}

export default class SimilarNotesPlugin extends Plugin {
    settings: SimilarNotesSettings; // 설정 변수 추가
    private isSearching = false; // 잠금 변수 추가

	async onload() {
		await this.loadSettings(); // 설정 로드 함수 호출

		this.addRibbonIcon('link', 'Find similar notes', () => {
			// 리본 아이콘 클릭 시 동작할 내용
            const editor = this.app.workspace.activeEditor?.editor;
            if (editor) {
                const selectedText = editor.getSelection();
                if (selectedText.trim() !== '') {
                    this.findAndShowSimilarContent(selectedText, editor);
                } else {
                    new Notice('Please select text first to find similar notes.');
                }
            } else {
                new Notice('Please open a note and select text first.');
            }
		});

		this.addCommand({
			id: 'find-similar-content',
			name: 'Find similar content for selection',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const selectedText = editor.getSelection();
				if (selectedText.trim() !== '') {
					this.findAndShowSimilarContent(selectedText, editor);
				} else {
					new Notice('Please select text to find similar content.');
				}
			}
		});

    // --- 설정 탭 추가 ---
		this.addSettingTab(new SimilarNotesSettingTab(this.app, this));
	}

	onunload() { }

    // --- 설정 저장/로드 함수 추가 ---
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * @param query 사용자가 선택한 텍스트
	 * @param editor 링크를 삽입할 에디터 인스턴스
	 */

    async findAndShowSimilarContent(query: string, editor: Editor) {
        if (this.isSearching) {
            new Notice("A search is already in progress. Please wait.");
            return;
        }
        this.isSearching = true;

        let notice: Notice | null = null;
        const noticeTimeout = setTimeout(() => {
            notice = new Notice(`Searching for content similar to "${query.trim()}"...`, 0);
        }, 500);

        try {
            const cleanQuery = query.trim();
            if (cleanQuery.length < 2) {
                new Notice("Please select at least 2 characters.");
                return; // 여기서 return해도 finally 블록이 실행됨
            }

            const queryWords = new Set(
                cleanQuery.toLowerCase().split(/\s+/)
                    .filter(word => word.length > 0 && !STOPWORDS.has(word))
            );

            if (queryWords.size === 0) {
                new Notice("Query contains only common words. Please try a more specific query.");
                return;
            }

            const allFiles = this.app.vault.getMarkdownFiles();
            const searchResults: SimilarContentResult[] = [];
            const currentFile = this.app.workspace.getActiveFile();
            const foldersToIgnore = new Set(this.settings.foldersToIgnore);

            for (const file of allFiles) {
                if (currentFile && file.path === currentFile.path) continue;
                if (foldersToIgnore.size > 0 && Array.from(foldersToIgnore).some(folder => file.path.startsWith(folder))) continue;

                const fileCache = this.app.metadataCache.getFileCache(file);
                if (!fileCache) continue;
                
                const content = await this.app.vault.cachedRead(file);

                const processContent = (text: string, type: 'heading' | 'block', linkTarget: string) => {
                    const contentWords = new Set(
                        text.toLowerCase().split(/\s+/).filter(word => !STOPWORDS.has(word))
                    );
                    let matchCount = 0;
                    for (const queryWord of queryWords) {
                        if (contentWords.has(queryWord)) {
                            matchCount++;
                        }
                    }
                    if (matchCount > 0) {
                        const score = matchCount / queryWords.size;
                        const displayText = type === 'heading' 
                            ? `[H] ${text}` 
                            : `[P] ${text.substring(0, 100).trim()}`;
                        searchResults.push({ file, content: text, displayText, type, linkTarget, score });
                    }
                };
                
                if (fileCache.headings) {
                    for (const heading of fileCache.headings) {
                        processContent(heading.heading, 'heading', heading.heading);
                    }
                }
                
                if (fileCache.sections) {
                    for (const section of fileCache.sections) {
                        if (section.type === 'heading') continue;
                        const sectionText = content.substring(section.position.start.offset, section.position.end.offset);
                        if (sectionText.trim().length > 0) {
                            let blockId: string | undefined = undefined;
                            if (fileCache.blocks) {
                                for (const id in fileCache.blocks) {
                                    if (fileCache.blocks[id].position.start.line === section.position.start.line) {
                                        blockId = id;
                                        break;
                                    }
                                }
                            }
                            const linkTarget = blockId ? `^${blockId}` : sectionText.split('\n')[0];
                            processContent(sectionText, 'block', linkTarget);
                        }
                    }
                }
            }

            if (searchResults.length > 0) {
                const filteredResults = searchResults.filter(result => result.score >= this.settings.minScore);
                filteredResults.sort((a, b) => b.score - a.score);
                const uniqueResults = filteredResults.filter((result, index, self) =>
                    index === self.findIndex((r) => (r.file.path === result.file.path && r.content === result.content))
                );
                const topResults = uniqueResults.slice(0, this.settings.maxResults);

                if (topResults.length > 0) {
                    new SimilarContentModal(this.app, topResults, editor, query).open();
                } else {
                    new Notice('No results matched your filter settings. Try adjusting them in the plugin settings.');
                }
            } else {
                new Notice('No similar content found.');
            }

        } catch (error) {
            console.error("Error during similar content search:", error);
            new Notice("An unexpected error occurred. Please check the developer console for details.");
        } finally {
            clearTimeout(noticeTimeout);
            if (notice) {
                notice.hide();
            }
            this.isSearching = false;
        }
    }
}

class SimilarContentModal extends FuzzySuggestModal<SimilarContentResult> {
	constructor(
		app: App, 
		private results: SimilarContentResult[], 
		private editor: Editor,
		private originalSelection: string
	) {
		super(app);
	}

	getItems(): SimilarContentResult[] {
		return this.results;
	}

    onChooseItem(item: SimilarContentResult, evt: MouseEvent | KeyboardEvent): void {
        const inNewTab = evt.ctrlKey || evt.metaKey;

        const filePath = this.app.metadataCache.fileToLinktext(item.file, '', true);
        let linkPath = filePath;

        if (item.type === 'heading') {
            linkPath = `${filePath}#${item.linkTarget}`;
        } else if (item.type === 'block' && item.linkTarget.startsWith('^')) {
            linkPath = `${filePath}#${item.linkTarget}`;
        }

        if (inNewTab) {
            // 새 탭에서 링크 열기
            this.app.workspace.openLinkText(linkPath, item.file.path, true);
            new Notice(`Opened "${item.file.basename}" in a new tab.`);
        } else {
            // 현재 에디터에 링크 삽입
            const linkText = `[[${linkPath}|${this.originalSelection}]]`;
            this.editor.replaceSelection(linkText);
            new Notice(`Link to "${item.file.basename}" inserted.`);
        }
    }
	
    renderSuggestion(match: FuzzyMatch<SimilarContentResult>, el: HTMLElement): void {
        el.empty();
        el.addClass('similar-notes-result-item');

        const contentEl = el.createDiv({ cls: 'suggestion-content' });
        
        contentEl.createDiv({ 
            text: match.item.type === 'heading' ? 'H' : 'P',
            cls: 'suggestion-type-icon' 
        });

        const mainText = match.item.displayText.substring(match.item.displayText.indexOf(']') + 2);
        contentEl.createDiv({
            text: mainText,
            cls: 'suggestion-main-text'
        });

        const score = match.item.score;
        const scoreText = `${(score * 100).toFixed(0)}%`;
        contentEl.createDiv({
            text: scoreText,
            cls: 'suggestion-score-badge'
        });

        const auxEl = el.createDiv({ cls: 'suggestion-aux' });
        auxEl.createEl('span', {
            text: match.item.file.path,
            cls: 'suggestion-file-path'
        });
    }

    getItemText(item: SimilarContentResult): string {
        return `${item.file.basename} ${item.displayText}`;
    }
}

class SimilarNotesSettingTab extends PluginSettingTab {
	plugin: SimilarNotesPlugin;

	constructor(app: App, plugin: SimilarNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {text: 'EasyLink Settings'});

        // 1. 무시할 폴더 설정
		new Setting(containerEl)
			.setName('Folders to ignore')
			.addTextArea(text => text
				.setPlaceholder('Templates/\nAttachments/')
				.setValue(this.plugin.settings.foldersToIgnore.join('\n'))
				.onChange(async (value) => {
					this.plugin.settings.foldersToIgnore = value.split('\n').map(p => p.trim()).filter(p => p.length > 0);
					await this.plugin.saveSettings();
				}));
				
		// 2. 최대 결과 수 설정
		new Setting(containerEl)
			.setName('Maximum results')
			.addSlider(slider => slider
				.setLimits(5, 100, 5)
				.setValue(this.plugin.settings.maxResults)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxResults = value;
					await this.plugin.saveSettings();
				}));

        // 3. 최소 유사도 점수 설정
        new Setting(containerEl)
            .setName('Minimum score threshold')
            .setDesc('Only show results with a similarity score above this value.')
            .addExtraButton(btn => {
                btn
                    .setIcon('reset') // 리셋 아이콘
                    .setTooltip('Reset to default')
                    .onClick(async () => {
                        this.plugin.settings.minScore = DEFAULT_SETTINGS.minScore;
                        await this.plugin.saveSettings();
                        
                        this.display();
                    });
            })
            .addSlider(slider => {
                slider
                    .setLimits(0, 100, 1) // 최소값 0%는 모든 결과를 허용함 (필터 없음)
                    .setValue(this.plugin.settings.minScore * 100)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.minScore = value / 100;
                        await this.plugin.saveSettings();
                    });
            });
	}
}