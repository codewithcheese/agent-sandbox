const { Plugin, Notice } = require("obsidian");

// dev-proxy.js
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
  // Class properties
  pluginInstance = null;
  moduleInstance = null;
  statusBarItem = null;
  hmrEventListener = null;

  async onload() {
    console.log("Dev proxy loading...");
    console.log(`Using dev server: ${DEV_SERVER_URL}`);

    try {
      // Setup HMR
      await this.setupHMR();

      // Add status indicator
      this.setupStatusIndicator();

      // Load the plugin initially
      await this.loadPluginInstance();
    } catch (error) {
      this.handleError("Failed to load plugin from dev server", error);
    }
  }

  /**
   * Setup Hot Module Replacement
   */
  async setupHMR() {
    // Create and inject the HMR script
    const script = this.createHMRScript();
    document.head.appendChild(script);

    // Wait for the initial module to load
    await this.waitForModuleLoad();

    if (!window.devModule) {
      throw new Error("Dev module failed to load");
    }

    // Store the module instance
    this.moduleInstance = window.devModule;

    // Setup listener for module updates
    this.setupModuleUpdateListener();
  }

  /**
   * Create the script element for HMR
   */
  createHMRScript() {
    const script = document.createElement("script");
    script.type = "module";
    script.textContent = `
      // Import the HMR runtime
      import { createHotContext } from '${DEV_SERVER_URL}/@vite/client';
      
      // Create a hot context for main.ts
      const hot = createHotContext('/src/main.ts');
      
      // Initial import
      import * as mod from '${DEV_SERVER_URL}/src/main.ts';
      window.devModule = mod;
      
      // Set up HMR handling
      if (hot) {
        hot.accept((newMod) => {
          console.log('HMR update for plugin class detected');
          
          // Store the new module
          window.devModule = newMod || mod;
          
          // Signal that the module has been updated
          window.dispatchEvent(new CustomEvent('dev-module-updated'));
        });
      }
      
      // Signal that initial loading is complete
      window.dispatchEvent(new CustomEvent('dev-module-loaded'));
    `;
    return script;
  }

  /**
   * Wait for the module to load
   */
  waitForModuleLoad() {
    return new Promise((resolve) => {
      window.addEventListener("dev-module-loaded", resolve, { once: true });
    });
  }

  /**
   * Setup listener for module updates
   */
  setupModuleUpdateListener() {
    // Remove any existing listener
    if (this.hmrEventListener) {
      window.removeEventListener("dev-module-updated", this.hmrEventListener);
    }

    // Create and store the listener function
    this.hmrEventListener = async () => {
      console.log("Reloading plugin instance after HMR update");

      // Update the module instance
      this.moduleInstance = window.devModule;

      // Unload the current plugin instance
      await this.unloadPluginInstance();

      // Load the new plugin instance
      await this.loadPluginInstance();

      // Flash the status indicator to show update
      this.flashStatusIndicator();
    };

    // Add the listener
    window.addEventListener("dev-module-updated", this.hmrEventListener);
  }

  /**
   * Setup status indicator in the status bar
   */
  setupStatusIndicator() {
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setText("🔥 HMR Active");
    this.statusBarItem.addClass("hmr-status-indicator");
  }

  /**
   * Flash the status indicator to show an update
   */
  flashStatusIndicator() {
    if (!this.statusBarItem) return;

    // Add a flash class
    this.statusBarItem.addClass("hmr-status-flash");
    this.statusBarItem.setText("🔄 HMR Updated");

    // Remove it after a delay
    setTimeout(() => {
      this.statusBarItem.removeClass("hmr-status-flash");
      this.statusBarItem.setText("🔥 HMR Active");
    }, 1000);
  }

  /**
   * Load the plugin instance
   */
  async loadPluginInstance() {
    try {
      // Get the plugin class from the current module instance
      const PluginClass = this.moduleInstance.default;

      // Instantiate the plugin
      this.pluginInstance = new PluginClass(this.app, this.manifest);
      await this.pluginInstance.onload();

      console.log("Plugin instance loaded successfully");
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

  /**
   * Handle errors consistently
   */
  handleError(message, error) {
    console.error(message + ":", error);
    console.error(error.stack);

    // Optionally show error in UI
    new Notice(`${message}: ${error.message}`, 10000);
  }

  /**
   * Clean up when the proxy is unloaded
   */
  async onunload() {
    // Unload the current plugin instance
    await this.unloadPluginInstance();

    // Remove event listeners
    if (this.hmrEventListener) {
      window.removeEventListener("dev-module-updated", this.hmrEventListener);
      this.hmrEventListener = null;
    }

    // Clean up global references
    delete window.obsidianAPI;
    delete window.devModule;

    // Clear module instance
    this.moduleInstance = null;

    console.log("Dev proxy unloaded");
  }
}

module.exports = ProxyPlugin;
