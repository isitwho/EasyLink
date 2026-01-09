import { App, normalizePath, TFile } from "obsidian";
import { EasyLinkSettings, SearchResult } from "../types";

export class SearchEngine {
    constructor(private app: App, private settings: EasyLinkSettings, private stopwords: Set<string>) { }

    async performSearch(query: string, searchTerms: Set<string>): Promise<SearchResult[]> {
        const searchResults: SearchResult[] = [];
        const files = this.app.vault.getMarkdownFiles();
        const currentFile = this.app.workspace.getActiveFile();
        const foldersToIgnore = new Set(this.settings.foldersToIgnore.map(normalizePath));

        // 최적화: 정규식 미리 생성 및 캐싱 고려 (여기서는 단순화)
        const queryTermsArray = Array.from(searchTerms);

        for (const file of files) {
            if (!this.settings.searchCurrentFile && currentFile && file.path === currentFile.path) continue;

            if (foldersToIgnore.size > 0) {
                const isIgnored = Array.from(foldersToIgnore).some((folder) =>
                    normalizePath(file.path).startsWith(folder)
                );
                if (isIgnored) continue;
            }

            const fileCache = this.app.metadataCache.getFileCache(file);
            if (!fileCache) continue;

            // 파일 내용을 미리 읽지 않고, 섹션이 있을 때만 읽도록 지연 로딩 최적화
            let fileContent: string | null = null;
            const getFileContent = async () => {
                if (fileContent === null) fileContent = await this.app.vault.cachedRead(file);
                return fileContent;
            };

            const processContent = (
                text: string,
                type: "heading" | "block",
                linkTarget: string,
                originalMarkdown: string,
                position?: any
            ) => {
                const words = text.toLowerCase().split(/\s+/);
                let matchCount = 0;

                // 최적화: Set.has() 사용을 위해 contentWords를 한 번만 생성
                const contentWords = new Set(words.filter(word => !this.stopwords.has(word)));

                for (const term of queryTermsArray) {
                    if (contentWords.has(term)) matchCount++;
                }

                if (matchCount > 0) {
                    const score = matchCount / searchTerms.size;
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
                    processContent(h.heading, "heading", h.heading, "#".repeat(h.level) + " " + h.heading);
                }
            }

            if (fileCache.sections) {
                const content = await getFileContent();
                for (const section of fileCache.sections) {
                    if (section.type === "heading") continue;

                    const sectionText = content.substring(
                        section.position.start.offset,
                        section.position.end.offset
                    );

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

        // 점수순 정렬 및 중복 제거
        return searchResults
            .sort((a, b) => b.score - a.score)
            .filter((result, index, self) =>
                index === self.findIndex((r) =>
                    r.file.path === result.file.path && r.content === result.content
                )
            )
            .slice(0, this.settings.maxResults);
    }
}
