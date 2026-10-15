import type { CachedMetadata, Pos } from "obsidian";

export interface SearchBlock {
	content: string;
	position: Pos;
	id?: string;
	standaloneId: boolean;
}

export interface SearchParagraph {
	content: string;
	position: Pos;
	targets: SearchBlock[];
}

/** Keep paragraph context separate from the smaller blocks available for linking. */
export function getSearchParagraphs(content: string, cache: CachedMetadata): SearchParagraph[] {
	const paragraphs: SearchParagraph[] = [];
	const lines = content.split("\n");
	const offsets: number[] = [];
	let offset = 0;
	for (const line of lines) {
		offsets.push(offset);
		offset += line.length + 1;
	}
	const pointAt = (offset: number, line: number) => ({
		offset, line, col: offset - offsets[line],
	});
	for (const section of cache.sections ?? []) {
		if (section.type === "heading") continue;
		const targets: SearchBlock[] = [];
		const items = section.type === "list"
			? (cache.listItems ?? []).filter(item =>
				item.position.start.offset >= section.position.start.offset &&
				item.position.start.offset < section.position.end.offset
			).sort((a, b) => a.position.start.offset - b.position.start.offset)
			: [];
		const ranges = items.length ? items.map((item, index) => {
			// A parent's cached range can include its children. Search its own text only.
			const nextLine = items[index + 1]?.position.start.line;
			let endLine = Math.min(item.position.end.line, section.position.end.line);
			if (nextLine !== undefined) endLine = Math.min(endLine, nextLine - 1);
			while (endLine > item.position.start.line && !lines[endLine].trim()) endLine--;
			const endOffset = Math.min(
				offsets[endLine] + lines[endLine].replace(/\r$/, "").length,
				section.position.end.offset,
			);
			return {
				position: { start: item.position.start, end: pointAt(endOffset, endLine) },
				id: item.id,
			};
		}) : [{ position: section.position, id: section.id }];
		for (const range of ranges) {
			const text = content.slice(range.position.start.offset, range.position.end.offset);
			if (!text.trim() || /^\s*\^[a-zA-Z0-9-]+\s*$/.test(text)) continue;
			// An ID on the last list item must never identify the entire list.
			const cachedId = Object.entries(cache.blocks ?? {}).find(([, block]) =>
				block.position.start.offset === range.position.start.offset &&
				block.position.end.offset === range.position.end.offset
			)?.[0];
			targets.push({
				content: text,
				position: range.position,
				id: range.id ?? cachedId,
				standaloneId: section.type !== "paragraph" && !(section.type === "list" && items.length > 0),
			});
		}
		if (targets.length) paragraphs.push({
			content: content.slice(section.position.start.offset, section.position.end.offset),
			position: section.position,
			targets,
		});
	}
	return paragraphs;
}

export function getBlockInsertion(content: string, block: SearchBlock): { offset: number; existingId?: string } {
	const { position } = block;
	if (content.slice(position.start.offset, position.end.offset) !== block.content) {
		throw new Error("The search result has changed. Run the search again before inserting a link.");
	}
	const text = block.content.replace(/[\r\n]+$/, "");
	return {
		offset: position.start.offset + text.length,
		existingId: block.id ?? (!block.standaloneId ? text.split("\n").pop()?.match(/\s\^([a-zA-Z0-9-]+)\s*$/)?.[1] : undefined),
	};
}

export function blockIdText(content: string, id: string, standalone: boolean): string {
	if (!standalone) return ` ^${id}`;
	const newline = content.includes("\r\n") ? "\r\n" : "\n";
	return `${newline}${newline}^${id}${newline}${newline}`;
}
