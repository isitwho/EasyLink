import { App, PluginSettingTab, Setting } from "obsidian";
import type EasyLinkPlugin from "../../main";

export class EasyLinkSettingTab extends PluginSettingTab {
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
