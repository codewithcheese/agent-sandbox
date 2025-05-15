import debug from "debug";

function getDebugPath(stack: string) {
  const stackLines = stack.split("\n");

  // 1️⃣ locate our own frame
  const selfIdx = stackLines.findIndex((l) => /\sat\s+createDebug\b/.test(l));
  const callerLine = stackLines[selfIdx + 1];
  if (!callerLine) return null; // reached top level

  // 2️⃣ extract the URL or path portion
  //     Works for both browser (http://…) and Node (/Users/…)
  const match = callerLine.match(/(?:https?:\/\/[^\s)]+|\/[^\s)]+)/);
  if (!match) return null;
  let path = match[0];

  // 3️⃣ trim query + position
  path = path.split("?")[0].replace(/:\d+:\d+$/, "");

  // 4️⃣ drop http(s) origin if present
  if (path.startsWith("http")) {
    try {
      path = new URL(path).pathname.replace(/^\/+/, "");
    } catch {
      /* keep as is if URL() fails */
    }
  }
  return path;
}

export function createDebug() {
  let path = "agent-sandbox";
  if (import.meta.env.DEV) {
    const tmp = new Error();
    path = getDebugPath(tmp.stack);
  }
  return debug(path);
}
