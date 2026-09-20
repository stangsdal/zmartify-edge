import { ESPLoader, Transport } from 'https://unpkg.com/esptool-js@0.5.4/bundle.js';

const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host { display: block; margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #d7e0dc; }
    section { display: grid; gap: 14px; }
    h2, p { margin: 0; }
    h2 { font-size: 19px; letter-spacing: 0; }
    p { line-height: 1.55; }
    button, a.action {
      display: inline-flex;
      min-height: 44px;
      align-items: center;
      padding: 0 18px;
      border: 1px solid #87a49a;
      border-radius: 4px;
      color: #075f51;
      background: #fff;
      font: inherit;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
    }
    button:hover, a.action:hover { background: #e8f0ed; }
    button:disabled { cursor: wait; opacity: 0.65; }
    button.compact { min-height: 36px; padding: 0 12px; }
    .status { min-height: 22px; color: #53635d; }
    .status.error { color: #a33724; }
    .result { display: grid; gap: 10px; padding: 14px; border: 1px solid #b9c8c1; border-radius: 6px; background: #f5f8f6; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
    .value { display: block; overflow-wrap: anywhere; font-family: "SFMono-Regular", Consolas, monospace; font-weight: 700; }
    .muted { color: #53635d; font-size: 14px; }
    [hidden] { display: none !important; }
    @media (max-width: 560px) {
      .row { grid-template-columns: 1fr; }
      .row button { justify-self: start; }
    }
  </style>
  <section aria-labelledby="identity-heading">
    <h2 id="identity-heading">Controller-identitet</h2>
    <p>Læs controllerens permanente MAC-adresse via USB før installationen. USB-porten frigives automatisk bagefter.</p>
    <div><button id="read-identity" type="button">Læs controller-ID</button></div>
    <p class="status" id="identity-status" role="status" aria-live="polite"></p>
    <div class="result" id="identity-result" hidden>
      <div class="row">
        <div><span class="muted">MAC-adresse</span><span class="value" id="controller-mac"></span></div>
        <button class="compact" type="button" data-copy-target="controller-mac">Kopiér MAC</button>
      </div>
      <div class="row">
        <div><span class="muted">Enheds-ID</span><span class="value" id="controller-device-id"></span></div>
        <button class="compact" type="button" data-copy-target="controller-device-id">Kopiér ID</button>
      </div>
      <div><a class="action" id="continue-onboarding" href="/app/onboarding/discover">Fortsæt til onboarding og gem</a></div>
    </div>
  </section>
`;

class ZmartifyControllerIdentity extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).append(template.content.cloneNode(true));
  }

  async connectedCallback() {
    const readButton = this.shadowRoot.querySelector('#read-identity');
    const status = this.shadowRoot.querySelector('#identity-status');
    const result = this.shadowRoot.querySelector('#identity-result');

    let controller;
    let expectedChip;
    try {
      const catalogResponse = await fetch(new URL('catalog.json', import.meta.url), { cache: 'no-store' });
      if (!catalogResponse.ok) throw new Error('Controllerkataloget kunne ikke indlæses.');
      const catalog = await catalogResponse.json();
      const controllerId = location.pathname.split('/').filter(Boolean).at(-2);
      controller = catalog.controllers?.find((candidate) => candidate.id === controllerId);
      if (!controller) throw new Error('Controllertypen findes ikke i kataloget.');

      const manifestResponse = await fetch(new URL(controller.manifest, new URL('catalog.json', import.meta.url)), { cache: 'no-store' });
      if (!manifestResponse.ok) throw new Error('Firmwaremanifestet kunne ikke indlæses.');
      const manifest = await manifestResponse.json();
      expectedChip = manifest.builds?.[0]?.chipFamily;
      if (!expectedChip) throw new Error('Firmwaremanifestet mangler chipfamilie.');
    } catch (error) {
      readButton.disabled = true;
      status.textContent = error instanceof Error ? error.message : 'Controllerdata kunne ikke indlæses.';
      status.classList.add('error');
      return;
    }

    readButton.addEventListener('click', async () => {
      if (!('serial' in navigator)) {
        status.textContent = 'Browseren understøtter ikke Web Serial. Brug Chrome eller Edge på en computer.';
        status.classList.add('error');
        return;
      }

      let transport;
      readButton.disabled = true;
      result.hidden = true;
      status.classList.remove('error');
      status.textContent = 'Vælg controllerens USB-port...';

      try {
        const port = await navigator.serial.requestPort();
        transport = new Transport(port);
        const loader = new ESPLoader({ transport, baudrate: 115200 });
        status.textContent = 'Forbinder til controlleren...';
        await loader.detectChip();
        if (loader.chip?.CHIP_NAME !== expectedChip) {
          throw new Error(`Den valgte enhed er ${loader.chip?.CHIP_NAME || 'ukendt'}, ikke ${expectedChip}.`);
        }

        const mac = String(await loader.chip.readMac(loader)).toUpperCase();
        const macHex = mac.replace(/[^0-9A-F]/g, '').toLowerCase();
        if (!/^[0-9a-f]{12}$/.test(macHex)) throw new Error('Controllerens MAC-adresse kunne ikke læses.');

        const deviceId = `${controller.artifact_prefix}-${macHex}`;
        this.shadowRoot.querySelector('#controller-mac').textContent = mac;
        this.shadowRoot.querySelector('#controller-device-id').textContent = deviceId;
        const onboardingUrl = new URL('/app/onboarding/discover', location.origin);
        onboardingUrl.searchParams.set('device_id', deviceId);
        onboardingUrl.searchParams.set('controller_name', controller.name);
        this.shadowRoot.querySelector('#continue-onboarding').href = onboardingUrl.toString();
        result.hidden = false;
        status.textContent = 'Controller-ID læst. Fortsæt til onboarding for at gemme identiteten, eller vælg den samme USB-port under installationen.';
      } catch (error) {
        status.textContent = error?.name === 'NotFoundError'
          ? 'Ingen USB-port blev valgt.'
          : error instanceof Error ? error.message : 'Controller-ID kunne ikke læses.';
        status.classList.add('error');
      } finally {
        if (transport) {
          try { await transport.disconnect(); } catch { /* Port may already be closed after USB reset. */ }
        }
        readButton.disabled = false;
      }
    });

    this.shadowRoot.querySelectorAll('[data-copy-target]').forEach((button) => {
      button.addEventListener('click', async () => {
        const value = this.shadowRoot.querySelector(`#${button.dataset.copyTarget}`).textContent;
        await navigator.clipboard.writeText(value);
        const previousText = button.textContent;
        button.textContent = 'Kopieret';
        setTimeout(() => { button.textContent = previousText; }, 1500);
      });
    });
  }
}

customElements.define('zmartify-controller-identity', ZmartifyControllerIdentity);
