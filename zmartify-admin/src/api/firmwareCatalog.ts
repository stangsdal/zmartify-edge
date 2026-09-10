export type FirmwareCatalogController = {
  id: string;
  name: string;
  category: string;
  description: string;
  artifact_prefix: string;
  device_id_patterns: string[];
  latest: string;
  releases: string;
  installer: string;
  manifest: string;
  checksum: string;
};

export type FirmwareCatalogRelease = FirmwareCatalogController & {
  version: string;
  chipFamily: string;
  recoveryUrl: string;
  recoveryFilename: string;
  installerUrl: string;
  otaUrl?: string;
  otaFilename?: string;
};

type FirmwareCatalog = {
  controllers: FirmwareCatalogController[];
};

type FirmwareReleaseIndex = {
  releases: Array<{
    version: string;
    recovery?: { path: string; sha256: string };
    ota?: { path: string; filename?: string; sha256: string };
  }>;
};

type EspWebToolsManifest = {
  version?: string;
  builds?: Array<{
    chipFamily?: string;
    parts?: Array<{ path?: string }>;
  }>;
};

const firmwareRoot = '/app/firmware/';

export async function loadFirmwareCatalog(): Promise<FirmwareCatalogRelease[]> {
  const catalogResponse = await fetch(`${firmwareRoot}catalog.json`, { cache: 'no-store' });
  if (!catalogResponse.ok) {
    throw new Error('Firmware catalog could not be loaded.');
  }

  const catalog = await catalogResponse.json() as FirmwareCatalog;
  const controllerReleases = await Promise.all(catalog.controllers.map(async (controller) => {
    const manifestUrl = new URL(controller.manifest, new URL(firmwareRoot, window.location.origin));
    const releasesUrl = new URL(controller.releases, new URL(firmwareRoot, window.location.origin));
    const [manifestResponse, releasesResponse] = await Promise.all([
      fetch(manifestUrl, { cache: 'no-store' }),
      fetch(releasesUrl, { cache: 'no-store' }),
    ]);
    if (!manifestResponse.ok || !releasesResponse.ok) {
      throw new Error(`Firmware releases could not be loaded for ${controller.name}.`);
    }

    const manifest = await manifestResponse.json() as EspWebToolsManifest;
    const build = manifest.builds?.[0];
    const releaseIndex = await releasesResponse.json() as FirmwareReleaseIndex;
    if (!manifest.version || !releaseIndex.releases?.length) {
      throw new Error(`Firmware manifest is incomplete for ${controller.name}.`);
    }

    return releaseIndex.releases.map((release) => ({
        ...controller,
        version: release.version,
        chipFamily: build?.chipFamily || 'Unknown',
        recoveryUrl: release.recovery ? new URL(release.recovery.path, releasesUrl).toString() : '',
        recoveryFilename: release.recovery?.path.split('/').pop() || '',
        installerUrl: new URL(controller.installer, new URL(firmwareRoot, window.location.origin)).toString(),
        otaUrl: release.ota ? new URL(release.ota.path, releasesUrl).toString() : undefined,
        otaFilename: release.ota?.filename || release.ota?.path.split('/').pop(),
      }));
  }));
  return controllerReleases.flat();
}
