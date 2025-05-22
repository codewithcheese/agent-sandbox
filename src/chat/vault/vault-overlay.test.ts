import { beforeEach, describe, it } from "vitest";
import { vault, helpers } from "../../../tests/mocks/obsidian";
import { VaultOverlay } from "../vault-overlay.svelte.ts";
import type { Vault } from "obsidian";

describe("Vault Overlay", () => {
  let overlay: VaultOverlay;

  beforeEach(() => {
    overlay = new VaultOverlay(vault as unknown as Vault);
  });

  it("should find node in staging and not master", () => {});

  it("should find node in master and not staging", () => {});

  it("should find node in both staging and master", () => {});
});
