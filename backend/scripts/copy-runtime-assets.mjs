import { mkdir, readdir, copyFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const extensions = new Set([".docx", ".json", ".ttf", ".otf", ".woff", ".woff2", ".png", ".jpg", ".jpeg", ".svg", ".html", ".css"]);

async function copyAssets(relative = "") {
  const source = join(root, "src", relative);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const child = join(relative, entry.name);
    if (entry.isDirectory()) await copyAssets(child);
    else if (extensions.has(extname(entry.name).toLowerCase())) {
      const target = join(root, "dist", relative);
      await mkdir(target, { recursive: true });
      await copyFile(join(source, entry.name), join(target, entry.name));
    }
  }
}

await copyAssets();
