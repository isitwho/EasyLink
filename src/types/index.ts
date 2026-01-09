import { TFile, Pos } from "obsidian";

export interface EasyLinkSettings {
    foldersToIgnore: string[];
    maxResults: number;
    minScore: number;
    useDefaultStopwords: boolean;
    customStopwords: string[];
    searchCurrentFile: boolean;
}

export const DEFAULT_SETTINGS: EasyLinkSettings = {
    foldersToIgnore: [],
    maxResults: 25,
    minScore: 0.1,
    useDefaultStopwords: true,
    customStopwords: [],
    searchCurrentFile: false,
};

export interface SearchResult {
    file: TFile;
    content: string;
    score: number;
    type: "heading" | "block";
    linkTarget: string;
    position?: Pos;
}
