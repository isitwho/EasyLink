import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();

const anHour = 1000 * 60 * 60;
const anHourAgo = Date.now() - anHour;

class HotReload {
	constructor() {
		const manifest = this.getManifest();
		this.pluginId = manifest.id;

		this.vaultPath = this.getVaultPath();
		if (!this.vaultPath) {
			console.warn(
				"Vault path not found. Please set OBSIDIAN_VAULT_PATH in .env file."
			);
			return;
		}

		this.pluginDir = path.join(
			this.vaultPath,
			".obsidian",
			"plugins",
			this.pluginId
		);
		console.log(`Plugin directory: ${this.pluginDir}`);
	}

	getManifest() {
		const manifestPath = "manifest.json";
		try {
			const manifest = fs.readFileSync(manifestPath, "utf8");
			return JSON.parse(manifest);
		} catch (e) {
			throw new Error(`Could not read manifest.json: ${e.message}`);
		}
	}

	getVaultPath() {
		return process.env.OBSIDIAN_VAULT_PATH;
	}

	/**
	 * @param {string} source
	 */
	async copyFile(source) {
		if (!this.vaultPath) return;

		try {
			await fs.promises.mkdir(this.pluginDir, { recursive: true });
			const destPath = path.join(this.pluginDir, path.basename(source));
			await fs.promises.copyFile(source, destPath);
			console.log(`Copied ${source} to ${destPath}`);
		} catch (error) {
			console.error(`Error copying file ${source}:`, error);
		}
	}

	async onBuild() {
		await this.copyFile("manifest.json");
		await this.copyFile("main.js");
		if (fs.existsSync("styles.css")) {
			await this.copyFile("styles.css");
		}
		console.log("Reloading plugin in Obsidian...");
	}
}

export const hotReload = new HotReload();
