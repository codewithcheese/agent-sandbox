import fs from "fs"; // real disk
import { Volume } from "memfs"; // in-memory layer
import { ufs } from "unionfs"; // union overlay
import * as git from "isomorphic-git";
import path from "path";

const memVol = Volume.fromJSON({}); // empty RAM FS
ufs.use(memVol).use(fs); // memVol has priority
git.plugins.set("fs", ufs as any); // isomorphic-git uses the overlay

const dir = path.resolve("./vault");
const gitdir = path.join(dir, ".git");

// 1) Initialise once
await git.init({ fs: ufs as any, dir, gitdir });

// 2) Start a new conversation turn
async function stageTurn(msgId: string, edits: Edit[]) {
  const branch = "refs/heads/ai/staging";
  await git
    .checkout({ fs: ufs as any, dir, ref: branch, force: true })
    .catch(() => git.branch({ fs: ufs as any, dir, ref: branch }));

  // Apply edits to memVol, then `git.add`/`git.remove`
  for (const e of edits) applyEditToMemVol(e);

  const sha = await git.commit({
    fs: ufs as any,
    dir,
    message: `msg:${msgId}`,
    author: { name: "AI-Agent", email: "agent@example.com" },
  });

  // Tag the commit with the msgId so it’s easy to drop later
  await git.writeRef({
    fs: ufs as any,
    gitdir,
    ref: `refs/notes/chat/${msgId}`,
    value: sha,
  });
}

// 3) On message deletion → drop commit
async function dropTurn(msgId: string) {
  const noteRef = `refs/notes/chat/${msgId}`;
  const sha = await git.resolveRef({ fs: ufs as any, gitdir, ref: noteRef });
  await git.updateRef({
    fs: ufs as any,
    gitdir,
    ref: "refs/heads/ai/staging",
    value: `${sha}^`, // parent of the commit
    force: true,
  });
  await git.deleteRef({ fs: ufs as any, gitdir, ref: noteRef });
}

// 4) Approve → merge into real FS branch
await git.merge({
  fs: ufs as any,
  dir,
  ours: "main",
  theirs: "ai/staging",
  fastForward: false,
  abortOnConflict: true,
});
