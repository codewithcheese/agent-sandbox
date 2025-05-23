import { describe, it, expect, beforeEach } from "vitest";
import {
  LoroDoc,
  LoroTree,
  LoroTreeNode,
  LoroText,
  type TreeID,
} from "loro-crdt";

/* ───────────── helpers ───────────── */

function ensureFolder(root: LoroTreeNode, parts: string[]): LoroTreeNode {
  let parent = root;
  for (const name of parts) {
    parent =
      parent.children()?.find((n) => n.data.get("name") === name) ??
      (() => {
        const c = parent.createNode();
        c.data.set("name", name);
        c.data.set("isDirectory", true);
        return c;
      })();
  }
  return parent;
}

function createNote(tree: LoroTree, path: string, content: string) {
  const segs = path.split("/");
  const file = segs.pop()!;
  const folder = ensureFolder(tree.roots()[0], segs);
  const node = folder.createNode();
  node.data.set("name", file);
  node.data.set("isDirectory", false);
  node.data.setContainer("text", new LoroText());
  (node.data.get("text") as LoroText).insert(0, content);
  return node.id;
}

function findNodeByPath(root: LoroTreeNode, parts: string[]): LoroTreeNode {
  let cur: LoroTreeNode | undefined = root;
  for (const p of parts) {
    cur = cur?.children()?.find((n) => n.data.get("name") === p);
    if (!cur) throw new Error("path not found");
  }
  return cur;
}

function forceOverwrite(node: LoroTreeNode, newText: string) {
  node.data.delete("text");
  const fresh = new LoroText();
  fresh.insert(0, newText);
  node.data.setContainer("text", fresh);
}

function overwrite(node: LoroTreeNode, newText: string) {
  const textContainer = node.data.get("text") as LoroText;
  if (textContainer.toString() === newText) return;
  textContainer.delete(0, textContainer.length);
  textContainer.insert(0, newText);
}

function text(node: LoroTreeNode) {
  return (node.data.get("text") as LoroText).toString();
}

/* ───────────── test suite ───────────── */

describe("VaultOverlay sync & merge", () => {
  let masterDoc: LoroDoc;
  let stagingDoc: LoroDoc;
  let masterRoot: LoroTreeNode;
  let stagingRoot: LoroTreeNode;

  beforeEach(() => {
    masterDoc = new LoroDoc();
    masterDoc.setPeerId(1);
    const mTree = masterDoc.getTree("vault");
    masterRoot = mTree.createNode();
    masterRoot.data.set("name", "");
    createNote(mTree, "Notes/idea.md", "Hello");
    masterDoc.commit();

    stagingDoc = LoroDoc.fromSnapshot(masterDoc.export({ mode: "snapshot" }));
    stagingDoc.setPeerId(2);
    stagingRoot = stagingDoc.getTree("vault").roots()[0];
  });

  it("accepts one file and keeps other proposals un-committed", () => {
    const ideaNode = findNodeByPath(stagingRoot, ["Notes", "idea.md"]);
    ideaNode.data.set("text", "Hello\n\nAI line");
    const draftId = createNote(
      stagingDoc.getTree("vault"),
      "Notes/draft.md",
      "Work in progress",
    );
    stagingDoc.commit();

    const approvedText = "Hello\n\nAI line\n\nApproved";
    const mIdea = findNodeByPath(masterRoot, ["Notes", "idea.md"]);
    forceOverwrite(mIdea, approvedText);
    masterDoc.commit();

    const patch = masterDoc.export({
      mode: "update",
      from: stagingDoc.version(),
    });
    stagingDoc.import(patch);

    const masterText = (
      findNodeByPath(masterRoot, ["Notes", "idea.md"]).data.get(
        "text",
      ) as LoroText
    ).toString();
    expect(masterText).toBe(approvedText);

    const stagingText = (
      findNodeByPath(stagingRoot, ["Notes", "idea.md"]).data.get(
        "text",
      ) as LoroText
    ).toString();
    expect(stagingText).toBe(approvedText);

    expect(() => findNodeByPath(masterRoot, ["Notes", "draft.md"])).toThrow();
    const draftText = (
      stagingDoc
        .getTree("vault")
        .getNodeByID(draftId)
        .data.get("text") as LoroText
    ).toString();
    expect(draftText).toBe("Work in progress");
  });

  it("merges vault edits into staging without losing AI edits", () => {
    /* agent edits */
    const sIdea = findNodeByPath(stagingRoot, ["Notes", "idea.md"]);
    const sText = sIdea.data.get("text") as LoroText;
    sText.delete(0, sText.length);
    sText.insert(0, "Hello\n\nAI line");
    stagingDoc.commit();

    /* human edits same file in vault (master) */
    const mIdea = findNodeByPath(masterRoot, ["Notes", "idea.md"]);
    const mText = mIdea.data.get("text") as LoroText;
    mText.insert(mText.length, "\n\n# Vault note");
    masterDoc.commit();

    /* sync vault ➜ staging */
    const patch = masterDoc.export({
      mode: "update",
      from: stagingDoc.version(),
    });
    stagingDoc.import(patch);

    /* assertions */
    const mergedText = (
      findNodeByPath(stagingRoot, ["Notes", "idea.md"]).data.get(
        "text",
      ) as LoroText
    ).toString();

    expect(mergedText.includes("AI line")).toBe(true);
    expect(mergedText.includes("# Vault note")).toBe(true);
  });

  it("accepts a newly-created file", () => {
    const idDraft = createNote(
      stagingDoc.getTree("vault"),
      "Notes/draft.md",
      "Draft from AI",
    );
    stagingDoc.commit(); // proposal

    const base = masterDoc.version(); // before accept
    // user approves “draft.md”
    masterDoc.import(stagingDoc.export({ mode: "update", from: base }));
    const patch = masterDoc.export({ mode: "update", from: base });
    stagingDoc.import(patch);

    expect(() =>
      findNodeByPath(masterRoot, ["Notes", "draft.md"]),
    ).not.toThrow();
    expect(text(findNodeByPath(masterRoot, ["Notes", "draft.md"]))).toBe(
      "Draft from AI",
    );

    // staging still identical for that note
    expect(text(stagingDoc.getTree("vault").getNodeByID(idDraft))).toBe(
      "Draft from AI",
    );
  });

  /* ───────── delete ───────── */

  it("accepts an AI delete", () => {
    const sIdea = findNodeByPath(stagingRoot, ["Notes", "idea.md"]);
    stagingDoc.getTree("vault").delete(sIdea.id);
    stagingDoc.commit();

    const base = masterDoc.version();
    // user approves deletion
    const mIdea = findNodeByPath(masterRoot, ["Notes", "idea.md"]);
    masterDoc.getTree("vault").delete(mIdea.id);
    masterDoc.commit();

    const patch = masterDoc.export({ mode: "update", from: base });
    stagingDoc.import(patch);

    expect(() => findNodeByPath(masterRoot, ["Notes", "idea.md"])).toThrow();
    expect(() => findNodeByPath(stagingRoot, ["Notes", "idea.md"])).toThrow();
  });

  /* merge path: vault deletes while AI edits */
  it("merges vault delete into staging, losing AI edits", () => {
    findNodeByPath(stagingRoot, ["Notes", "idea.md"]).data.set(
      "text",
      "AI tweak",
    );
    stagingDoc.commit();

    const ideaNode = findNodeByPath(masterRoot, ["Notes", "idea.md"]);
    masterDoc.getTree("vault").delete(ideaNode.id); // human delete
    masterDoc.commit();

    stagingDoc.import(
      masterDoc.export({ mode: "update", from: stagingDoc.version() }),
    );

    expect(() => findNodeByPath(stagingRoot, ["Notes", "idea.md"])).toThrow();
  });

  /* ───────── rename ───────── */

  it("accepts an AI rename without losing vault edits", () => {
    /* AI renames + edits */
    const sIdea = findNodeByPath(stagingRoot, ["Notes", "idea.md"]);
    const tgt = ensureFolder(stagingRoot, ["Ideas"]);
    sIdea.move(tgt);
    sIdea.data.set("name", "vision.md");
    overwrite(sIdea, "AI vision");
    stagingDoc.commit();

    /* vault edits old path */
    const mIdea = findNodeByPath(masterRoot, ["Notes", "idea.md"]);
    (mIdea.data.get("text") as LoroText).insert(0, "Human gloss\n");
    masterDoc.commit();

    /* sync vault → staging so AI sees human edit */
    stagingDoc.import(
      masterDoc.export({ mode: "update", from: stagingDoc.version() }),
    );

    /* user approves rename */
    const base = masterDoc.version();
    masterDoc.import(stagingDoc.export({ mode: "update", from: base }));
    masterDoc.commit();
    stagingDoc.import(masterDoc.export({ mode: "update", from: base }));

    /* Assertions */
    expect(() =>
      findNodeByPath(masterRoot, ["Ideas", "vision.md"]),
    ).not.toThrow();
    const merged = text(findNodeByPath(masterRoot, ["Ideas", "vision.md"]));
    expect(merged.includes("AI vision")).toBe(true);
    expect(merged.includes("Human gloss")).toBe(true);

    // old path gone
    expect(() => findNodeByPath(masterRoot, ["Notes", "idea.md"])).toThrow();
  });
});
