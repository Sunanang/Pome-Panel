import { access, mkdir, rename, rm, readdir } from "node:fs/promises";
import path from "node:path";

const clientDirectory = path.resolve("dist/client");
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/^\/+|\/+$/g, "");

if (basePath) {
  const prefixedDirectory = path.join(clientDirectory, basePath);
  const generatedAssets = path.join(prefixedDirectory, "_next");
  const publishedAssets = path.join(clientDirectory, "_next");

  try {
    await access(generatedAssets);
    await mkdir(clientDirectory, { recursive: true });
    await rm(publishedAssets, { recursive: true, force: true });
    await rename(generatedAssets, publishedAssets);
    await rm(prefixedDirectory, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

// Publish nested routes as directories so Pages resolves /en/ consistently.
for (const entry of await readdir(clientDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.html') || ['index.html', '404.html'].includes(entry.name)) continue;
  const directory = path.join(clientDirectory, entry.name.slice(0, -5));
  await mkdir(directory, { recursive: true });
  await rename(path.join(clientDirectory, entry.name), path.join(directory, 'index.html'));
}
