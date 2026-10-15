import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);
const bundled = buildSync({
	stdin: {
		contents: readFileSync(new URL("../main.ts", import.meta.url), "utf8") +
			'\nexport { SearchEngine, AdvancedResultModal }; export * from "./search-blocks";',
		resolveDir: fileURLToPath(new URL("..", import.meta.url)),
		loader: "ts",
	},
	bundle: true, platform: "node", format: "cjs", external: ["obsidian"], write: false,
}).outputFiles[0].text;
class Modal { constructor(app) { this.app = app; } }
const module = { exports: {} };
vm.runInNewContext(bundled, {
	module, exports: module.exports, console,
	require: name => name === "obsidian" ? {
		Plugin: class {}, PluginSettingTab: class {}, FuzzySuggestModal: Modal,
		Notice: class {}, normalizePath: path => path,
	} : require(name),
});
const { getSearchParagraphs, getBlockInsertion, blockIdText, SearchEngine, AdvancedResultModal } = module.exports;
const getSearchBlocks = (content, cache) => getSearchParagraphs(content, cache).flatMap(paragraph => paragraph.targets);

function position(content, start, end) {
	const point = offset => {
		const prefix = content.slice(0, offset).split("\n");
		return { offset, line: prefix.length - 1, col: prefix.at(-1).length };
	};
	return { start: point(start), end: point(end) };
}
function listCache(content) {
	let start = 0;
	const listItems = content.split("\n").flatMap(line => {
		const offset = start;
		start += line.length + 1;
		return /^\s*(?:[-+*]|\d+[.)])\s/.test(line)
			? [{ position: position(content, offset, offset + line.replace(/\r$/, "").length), parent: -1,
				id: line.match(/ \^([\w-]+)\s*$/)?.[1] }] : [];
	});
	return { sections: [{ type: "list", position: position(content, 0, content.length) }], listItems };
}
function appFor(content, cache) {
	const file = { path: "Target.md", basename: "Target" };
	const state = { content };
	return { state, file, app: {
		vault: { getMarkdownFiles: () => [file], cachedRead: async () => state.content,
			process: async (_, update) => { state.content = update(state.content); } },
		workspace: { getActiveFile: () => null },
		metadataCache: { getFileCache: () => cache, fileToLinktext: () => "Target" },
	} };
}
async function search(fixture, terms) {
	return new SearchEngine(fixture.app, { foldersToIgnore: [], searchCurrentFile: true }, new Set())
		.performSearch(new Set(terms));
}

test("UL, OL, and tasks show the whole paragraph but link to the matching item", async () => {
	for (const marker of ["-", "*", "+", "1.", "1)", "- [ ]"]) {
		const content = `${marker} apple\n${marker} banana\n${marker} cherry`;
		const fixture = appFor(content, listCache(content));
		const results = await search(fixture, ["banana"]);
		assert.equal(results.length, 1);
		assert.equal(results[0].content, content);
		assert.equal(results[0].block.content, `${marker} banana`);
		let selection;
		const modal = new AdvancedResultModal(fixture.app, {}, results,
			{ replaceSelection: text => { selection = text; } }, "banana", new Set(["banana"]));
		await modal.insertLink(results[0]);
		assert.match(fixture.state.content, new RegExp(`banana \\^([a-z0-9]+)\\n`));
		assert.equal(fixture.state.content.split("\n")[2], `${marker} cherry`);
		const id = fixture.state.content.match(/\^([a-z0-9]+)/)[1];
		assert.equal(selection, `[[Target#^${id}|banana]]`);
	}
});

test("a last-item ID is never reused for another item", async () => {
	const content = "- apple\n- banana ^last";
	const cache = listCache(content);
	cache.blocks = { last: { position: cache.listItems[1].position } };
	const fixture = appFor(content, cache);
	const [first] = await search(fixture, ["apple"]);
	const [last] = await search(fixture, ["banana"]);
	assert.equal(first.linkTarget, "");
	assert.equal(last.linkTarget, "^last");
});

test("link creation reuses the selected item's existing ID without editing it", async () => {
	const content = "- apple ^apple-id\n- banana";
	const fixture = appFor(content, listCache(content));
	const results = await search(fixture, ["apple"]);
	const modal = new AdvancedResultModal(fixture.app, {}, results, {}, "apple", new Set());
	assert.equal(await modal.buildLinkPath(results[0]), "Target#^apple-id");
	assert.equal(fixture.state.content, content);
});

test("the active editor receives the ID on the matching item", async () => {
	const content = "- apple\n- banana\n- cherry";
	const fixture = appFor(content, listCache(content));
	fixture.app.workspace.getActiveFile = () => fixture.file;
	fixture.app.workspace.activeEditor = { editor: {
		getValue: () => fixture.state.content,
		offsetToPos: offset => offset,
		replaceRange: (text, offset) => {
			fixture.state.content = fixture.state.content.slice(0, offset) + text + fixture.state.content.slice(offset);
		},
	} };
	fixture.app.vault.process = () => { throw new Error("Expected the editor path"); };
	const results = await search(fixture, ["banana"]);
	const modal = new AdvancedResultModal(fixture.app, {}, results, {}, "banana", new Set());
	const link = await modal.buildLinkPath(results[0]);
	assert.match(link, /^Target#\^[a-z0-9]+$/);
	assert.match(fixture.state.content, /^- apple\n- banana \^[a-z0-9]+\n- cherry$/);
});

test("nested lists show the paragraph but target the matching child", async () => {
	const content = "- parent\n  - child\n- sibling";
	const cache = listCache(content);
	cache.listItems[0].position.end = cache.listItems[1].position.end;
	const fixture = appFor(content, cache);
	const results = await search(fixture, ["child"]);
	assert.equal(results.length, 1);
	assert.equal(results[0].content, content);
	assert.equal(results[0].block.content, "  - child");
	assert.equal(getSearchBlocks(content, cache)[0].content, "- parent");
});

test("continuation lines stay with their item and preserve CRLF", () => {
	const content = "- apple\r\n  continuation\r\n- banana\r\n";
	const cache = listCache(content);
	cache.listItems[0].position.end = position(content, 0, content.indexOf("\r\n- banana")).end;
	const [block] = getSearchBlocks(content, cache);
	assert.equal(block.content, "- apple\r\n  continuation");
	const insertion = getBlockInsertion(content, block);
	const updated = content.slice(0, insertion.offset) + blockIdText(content, "test", false) + content.slice(insertion.offset);
	assert.equal(updated, "- apple\r\n  continuation ^test\r\n- banana\r\n");
});

test("multiple matching items in one paragraph produce one result", async () => {
	const content = "- apple\n- apple";
	const results = await search(appFor(content, listCache(content)), ["apple"]);
	assert.equal(results.length, 1);
	assert.equal(results[0].block.position.start.offset, 0);
});

test("paragraph scoring spans items while the best matching item becomes the target", async () => {
	const content = "- apple\n- apple banana\n- cherry";
	const results = await search(appFor(content, listCache(content)), ["apple", "banana", "cherry"]);
	assert.equal(results.length, 1);
	assert.equal(results[0].score, 1);
	assert.equal(results[0].content, content);
	assert.equal(results[0].block.content, "- apple banana");
});

test("changed result text is rejected before modifying a file", () => {
	const content = "- apple\n- banana";
	const [block] = getSearchBlocks(content, listCache(content));
	assert.throws(() => getBlockInsertion(content.replace("apple", "grape"), block), /has changed/);
});

test("ordinary multiline paragraphs remain a single block", () => {
	const content = "apple\ncontinuation\n";
	const blocks = getSearchBlocks(content, { sections: [{ type: "paragraph", position: position(content, 0, content.length) }] });
	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].standaloneId, false);
	assert.equal(getBlockInsertion(content, blocks[0]).offset, content.length - 1);
});

test("structured blocks receive a standalone ID outside the block", () => {
	const content = "> quote\n> continued";
	const [block] = getSearchBlocks(content, { sections: [{ type: "blockquote", position: position(content, 0, content.length) }] });
	assert.equal(block.standaloneId, true);
	assert.equal(blockIdText(content, "quote-id", block.standaloneId), "\n\n^quote-id\n\n");
});

test("file titles are searchable even without a metadata cache or body", async () => {
	const fixture = appFor("", null);
	fixture.app.vault.cachedRead = () => { throw new Error("Title search should not read the body"); };
	const results = await search(fixture, ["target"]);
	assert.equal(results.length, 1);
	assert.equal(results[0].type, "file");
	assert.equal(results[0].content, "Target");
	assert.equal(results[0].score, 1);
	assert.equal(results[0].linkTarget, "");
});

test("file title links target the file itself and do not modify its content", async () => {
	const fixture = appFor("- body", listCache("- body"));
	fixture.app.vault.process = () => { throw new Error("File links should not modify the target"); };
	const results = await search(fixture, ["target"]);
	let selection;
	const modal = new AdvancedResultModal(fixture.app, {}, results,
		{ replaceSelection: text => { selection = text; } }, "target", new Set(["target"]));
	await modal.insertLink(results[0]);
	assert.equal(selection, "[[Target|target]]");
	assert.equal(fixture.state.content, "- body");
	let opened;
	fixture.app.workspace.openLinkText = async (...args) => { opened = args; };
	await modal.openNoteInNewTab(results[0]);
	assert.equal(opened[0], "Target");
});

test("matching file titles, headings, and paragraphs remain separate choices", async () => {
	const content = "# Target\n\nTarget body";
	const fixture = appFor(content, {
		headings: [{ heading: "Target", level: 1, position: position(content, 0, 8) }],
		sections: [{ type: "paragraph", position: position(content, 10, content.length) }],
	});
	const results = await search(fixture, ["target"]);
	assert.equal(results.length, 3);
	assert.equal(results.map(result => result.type).join(","), "file,heading,block");
});

test("ignored folders and current-file settings also apply to file title results", async () => {
	const fixture = appFor("", null);
	fixture.app.workspace.getActiveFile = () => fixture.file;
	const excludedCurrent = await new SearchEngine(fixture.app,
		{ foldersToIgnore: [], searchCurrentFile: false }, new Set()).performSearch(new Set(["target"]));
	assert.equal(excludedCurrent.length, 0);
	fixture.file.path = "Ignored/Target.md";
	const excludedFolder = await new SearchEngine(fixture.app,
		{ foldersToIgnore: ["Ignored"], searchCurrentFile: true }, new Set()).performSearch(new Set(["target"]));
	assert.equal(excludedFolder.length, 0);
});
