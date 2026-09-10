import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultCatalogRoot = resolve(adminRoot, 'public/firmware');
const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  values.set(process.argv[index], process.argv[index + 1]);
}

const controllerId = values.get('--controller');
const version = values.get('--version');
const otaSource = values.get('--ota');
const recoverySource = values.get('--recovery');
const chipFamily = values.get('--chip-family') || 'ESP32-S3';
const catalogRoot = resolve(values.get('--catalog-root') || process.env.ZMARTIFY_FIRMWARE_CATALOG_DIR || defaultCatalogRoot);

if (!controllerId || !version || !otaSource || !recoverySource || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('Usage: npm run firmware:publish -- --controller <id> --version <x.y.z> --ota <app.bin> --recovery <factory.bin> [--chip-family ESP32-S3] [--catalog-root <path>]');
}

const hashFile = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const writeJsonAtomic = async (path, value) => {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
};

const catalogPath = resolve(catalogRoot, 'catalog.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const controller = catalog.controllers?.find((candidate) => candidate.id === controllerId);
if (!controller) throw new Error(`Unknown firmware catalog controller: ${controllerId}`);
if (!controller.artifact_prefix || !controller.releases || !controller.manifest || !controller.checksum) {
  throw new Error(`Incomplete firmware catalog metadata: ${controllerId}`);
}

const releaseIndexPath = resolve(catalogRoot, controller.releases);
if (!releaseIndexPath.startsWith(`${catalogRoot}/`)) throw new Error('Release index escapes firmware catalog');
const releaseIndex = JSON.parse(await readFile(releaseIndexPath, 'utf8'));
if (releaseIndex.releases?.some((release) => release.version === version)) {
  throw new Error(`Firmware ${controllerId} ${version} is already published; bump CONFIG_APP_PROJECT_VER before building a new release`);
}

const releaseDirectory = dirname(releaseIndexPath);
await mkdir(releaseDirectory, { recursive: true });
const otaFilename = `${controller.artifact_prefix}-${version}.bin`;
const recoveryFilename = `${controller.artifact_prefix}-${version}.factory.bin`;
const otaTarget = resolve(releaseDirectory, otaFilename);
const recoveryTarget = resolve(releaseDirectory, recoveryFilename);
await copyFile(resolve(otaSource), otaTarget, 0x1);
await copyFile(resolve(recoverySource), recoveryTarget, 0x1);

const otaSha256 = await hashFile(otaTarget);
const recoverySha256 = await hashFile(recoveryTarget);
releaseIndex.releases = [
  {
    version,
    published_at: new Date().toISOString(),
    ota: { path: otaFilename, filename: otaFilename, sha256: otaSha256 },
    recovery: { path: recoveryFilename, sha256: recoverySha256 },
  },
  ...(releaseIndex.releases || []),
];

controller.latest = version;
const manifestPath = resolve(catalogRoot, controller.manifest);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.version = version;
manifest.builds = [{ chipFamily, parts: [{ path: recoveryFilename, offset: 0 }] }];

await writeJsonAtomic(releaseIndexPath, releaseIndex);
await writeJsonAtomic(manifestPath, manifest);
await writeFile(resolve(catalogRoot, controller.checksum), `${recoverySha256}  ${recoveryFilename}\n`, 'utf8');
await writeJsonAtomic(catalogPath, catalog);

console.log(`Published ${controller.name} ${version}`);
console.log(`OTA: ${otaTarget} (${otaSha256})`);
console.log(`Recovery: ${recoveryTarget} (${recoverySha256})`);