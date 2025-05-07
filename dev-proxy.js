const { Plugin, Notice } = require("obsidian");

const DEV_SERVER_URL = "http://localhost:5173";

// Create bridge object with all external packages
window.bridge = {
  obsidian: require("obsidian"),
  "@codemirror/autocomplete": require("@codemirror/autocomplete"),
  "@codemirror/collab": require("@codemirror/collab"),
  "@codemirror/commands": require("@codemirror/commands"),
  "@codemirror/language": require("@codemirror/language"),
  "@codemirror/lint": require("@codemirror/lint"),
  "@codemirror/search": require("@codemirror/search"),
  "@codemirror/state": require("@codemirror/state"),
  "@codemirror/view": require("@codemirror/view"),
  "@lezer/common": require("@lezer/common"),
  // "@lezer/highlight": require("@lezer/highlight"),
  "@lezer/lr": require("@lezer/lr"),
};
console.log("Bridge loaded", window.bridge);

class ProxyPlugin extends Plugin {
  pluginInstance = null;

  async onload() {
    console.log("Dev proxy loading...");
    console.log(`Using dev server: ${DEV_SERVER_URL}`);

    try {
      // Load the plugin initially
      await this.loadPluginInstance();
    } catch (error) {
      this.handleError("Failed to load plugin from dev server", error);
    }
  }

  /**
   * Load the plugin instance
   */
  async loadPluginInstance() {
    try {
      const module = await import(DEV_SERVER_URL + "/src/main.ts");

      const PluginClass = module.default;

      // Instantiate the plugin
      this.pluginInstance = new PluginClass(this.app, this.manifest);
      await this.pluginInstance.onload();

      // Listen for plugin updates and call reload() on plugin instance
      const viteClient = await import(`${DEV_SERVER_URL}/@vite/client`);
      const hot = await viteClient.createHotContext("/");
      hot.on("vite:afterUpdate", (payload) => {
        const pluginUpdate = payload.updates.find(
          (update) => update.path === "/src/plugin.ts",
        );
        if (pluginUpdate && this.pluginInstance.reload) {
          this.pluginInstance.reload();
        }
      });
    } catch (error) {
      this.handleError("Failed to load plugin instance", error);
    }
  }

  /**
   * Unload the current plugin instance
   */
  async unloadPluginInstance() {
    if (this.pluginInstance && this.pluginInstance.onunload) {
      try {
        await this.pluginInstance.onunload();
      } catch (error) {
        this.handleError("Error unloading plugin instance", error);
      }
    }
    this.pluginInstance = null;
  }

  handleError(message, error) {
    console.error(message + ":", error);
    console.error(error.stack);

    // Optionally show error in UI
    new Notice(`${message}: ${error.message}`, 10000);
  }

  async onunload() {
    await this.unloadPluginInstance();

    delete window.bridge;

    console.log("Dev proxy unloaded");
  }
}

module.exports = ProxyPlugin;
