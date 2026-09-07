import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public/firmware');
const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
const ids = new Set();

function resolveCatalogPath(path, label, controllerId) {
  if (typeof path !== 'string' || !path) throw new Error(`Missing ${label}: ${controllerId}`);
  const resolvedPath = resolve(root, path);
  if (!resolvedPath.startsWith(`${root}/`)) throw new Error(`${label} escapes firmware directory: ${controllerId}`);
  return resolvedPath;
}

for (const controller of catalog.controllers) {
  if (!controller.id || ids.has(controller.id)) throw new Error(`Invalid or duplicate controller ID: ${controller.id}`);
  ids.add(controller.id);
  for (const field of ['name', 'category', 'description']) {
    if (typeof controller[field] !== 'string' || !controller[field]) throw new Error(`Missing ${field}: ${controller.id}`);
  }

  const manifestPath = resolveCatalogPath(controller.manifest, 'manifest', controller.id);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const firmwarePath = manifest.builds?.[0]?.parts?.[0]?.path;
  if (!manifest.version || !firmwarePath) throw new Error(`Incomplete manifest: ${controller.id}`);

  const binaryPath = resolve(dirname(manifestPath), firmwarePath);
  const binary = await readFile(binaryPath);
  const actualHash = createHash('sha256').update(binary).digest('hex');
  const checksumText = await readFile(resolveCatalogPath(controller.checksum, 'checksum', controller.id), 'utf8');
  const [expectedHash, checksumFilename] = checksumText.trim().split(/\s+/);
  if (expectedHash !== actualHash || checksumFilename !== firmwarePath) {
    throw new Error(`Checksum mismatch: ${controller.id}`);
  }

  await readFile(resolveCatalogPath(controller.installer, 'installer', controller.id));
  console.log(`${controller.name}: ${manifest.version} (${firmwarePath})`);
}