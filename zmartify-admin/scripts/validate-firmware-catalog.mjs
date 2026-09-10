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
  for (const field of ['name', 'category', 'description', 'artifact_prefix', 'latest', 'releases']) {
    if (typeof controller[field] !== 'string' || !controller[field]) throw new Error(`Missing ${field}: ${controller.id}`);
  }
  if (!Array.isArray(controller.device_id_patterns) || !controller.device_id_patterns.length) {
    throw new Error(`Missing device_id_patterns: ${controller.id}`);
  }

  const manifestPath = resolveCatalogPath(controller.manifest, 'manifest', controller.id);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const firmwarePath = manifest.builds?.[0]?.parts?.[0]?.path;
  if (!manifest.version || manifest.version !== controller.latest || !firmwarePath) throw new Error(`Incomplete or stale manifest: ${controller.id}`);

  const binaryPath = resolve(dirname(manifestPath), firmwarePath);
  const binary = await readFile(binaryPath);
  const actualHash = createHash('sha256').update(binary).digest('hex');
  const checksumText = await readFile(resolveCatalogPath(controller.checksum, 'checksum', controller.id), 'utf8');
  const [expectedHash, checksumFilename] = checksumText.trim().split(/\s+/);
  if (expectedHash !== actualHash || checksumFilename !== firmwarePath) {
    throw new Error(`Checksum mismatch: ${controller.id}`);
  }

  const releaseIndexPath = resolveCatalogPath(controller.releases, 'release index', controller.id);
  const releaseIndex = JSON.parse(await readFile(releaseIndexPath, 'utf8'));
  const versions = new Set();
  for (const release of releaseIndex.releases || []) {
    if (!/^\d+\.\d+\.\d+$/.test(release.version || '') || versions.has(release.version)) {
      throw new Error(`Invalid or duplicate release version: ${controller.id}`);
    }
    versions.add(release.version);
    if (!release.ota && !release.recovery) throw new Error(`Release has no artifacts: ${controller.id} ${release.version}`);
    for (const [artifactType, artifact] of Object.entries({ ota: release.ota, recovery: release.recovery })) {
      if (!artifact) continue;
      if (typeof artifact.path !== 'string' || !artifact.path || !/^[a-f0-9]{64}$/i.test(artifact.sha256 || '')) {
        throw new Error(`Invalid ${artifactType} metadata: ${controller.id} ${release.version}`);
      }
      const artifactPath = resolve(dirname(releaseIndexPath), artifact.path);
      if (!artifactPath.startsWith(`${root}/`)) throw new Error(`${artifactType} artifact escapes firmware directory: ${controller.id}`);
      const artifactHash = createHash('sha256').update(await readFile(artifactPath)).digest('hex');
      if (artifactHash !== artifact.sha256.toLowerCase()) {
        throw new Error(`${artifactType} checksum mismatch: ${controller.id} ${release.version}`);
      }
    }
  }
  if (!versions.has(controller.latest)) throw new Error(`Latest release is missing: ${controller.id} ${controller.latest}`);

  await readFile(resolveCatalogPath(controller.installer, 'installer', controller.id));
  console.log(`${controller.name}: ${manifest.version} (${releaseIndex.releases.length} releases, ${firmwarePath})`);
}