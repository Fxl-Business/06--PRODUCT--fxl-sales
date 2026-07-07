import { spawn } from 'node:child_process';
import fs from 'node:fs';

const out = 'nexo/runs/20260706-2356-sales-ops-reference-ui';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = fs.mkdtempSync('/tmp/fxl-sales-ops-chrome-');
const port = 9227;
const appUrl = 'http://127.0.0.1:8016/';

fs.mkdirSync(out, { recursive: true });

const proc = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=2048,1120',
    appUrl,
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function waitWs() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json/list`);
      const page = list.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      await sleep(100);
    }
  }
  throw new Error('Chrome CDP did not start');
}

const wsUrl = await waitWs();
const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
const pageEvents = [];

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.consoleAPICalled') {
    pageEvents.push({
      method: msg.method,
      type: msg.params.type,
      args: msg.params.args?.map((arg) => arg.value ?? arg.description),
    });
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    pageEvents.push({
      method: msg.method,
      text: msg.params.exceptionDetails?.text,
      description: msg.params.exceptionDetails?.exception?.description,
    });
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
};

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
}

async function evalJs(expression) {
  const result = await cdp('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Page.navigate', { url: appUrl });
await sleep(1600);

await evalJs(`
  (() => {
    const byText = (text) =>
      [...document.querySelectorAll('button')].find((button) =>
        button.textContent && button.textContent.includes(text)
      );
    document.querySelector('button[title="Trocar workspace"]')?.click();
    setTimeout(() => byText('Configurações')?.click(), 50);
  })()
`);
await sleep(500);

const sidebarMetrics = await evalJs(`
  (() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height)
      };
    };
    return {
      pageTitle: document.querySelector('h1')?.textContent,
      sidebar: rect(document.querySelector('aside')),
      workspaceButton: rect(document.querySelector('button[title="Trocar workspace"]')),
      activeNav: [...document.querySelectorAll('nav button')]
        .map((button) => ({
          text: button.textContent?.trim(),
          bg: getComputedStyle(button).backgroundColor,
          color: getComputedStyle(button).color
        }))
        .find((item) => item.bg === 'rgb(243, 243, 245)')
    };
  })()
`);
const sidebarShot = await cdp('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: false,
});
fs.writeFileSync(`${out}/sidebar-headless.png`, Buffer.from(sidebarShot.data, 'base64'));

await evalJs(`
  (() => {
    const button = [...document.querySelectorAll('button')].find((candidate) =>
      candidate.textContent && candidate.textContent.includes('Novo produto')
    );
    button?.click();
  })()
`);
await sleep(700);

const metrics = await evalJs(`
  (() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height)
      };
    };
    const style = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        background: s.backgroundColor,
        backdropFilter: s.backdropFilter,
        borderRadius: s.borderRadius
      };
    };
    const dialog = document.querySelector('[role="dialog"]');
    const overlay = [...document.querySelectorAll('body > div')]
      .map((el) => ({
        el,
        z: getComputedStyle(el).zIndex,
        pos: getComputedStyle(el).position,
        bg: getComputedStyle(el).backgroundColor
      }))
      .find((entry) => entry.pos === 'fixed' && entry.bg !== 'rgba(0, 0, 0, 0)' && entry.el !== dialog)
      ?.el;
    return {
      pageTitle: document.querySelector('h1')?.textContent,
      sidebar: rect(document.querySelector('aside')),
      workspaceButton: rect(document.querySelector('button[title="Trocar workspace"]')),
      activeNav: [...document.querySelectorAll('nav button')]
        .map((button) => ({
          text: button.textContent?.trim(),
          bg: getComputedStyle(button).backgroundColor,
          color: getComputedStyle(button).color
        }))
        .find((item) => item.bg === 'rgb(243, 243, 245)'),
      dialog: rect(dialog),
      dialogStyle: style(dialog),
      overlay: style(overlay),
      modalText: dialog?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 140),
      footer: rect(dialog?.querySelector('form > div:last-child')),
      body: rect(dialog?.querySelector('form > div:first-child'))
      ,
      location: location.href,
      bodyText: document.body.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 260),
      html: document.body.innerHTML.slice(0, 600)
    };
  })()
`);

metrics.pageEvents = pageEvents;
metrics.sidebarBeforeModal = sidebarMetrics;
fs.writeFileSync(`${out}/visual-metrics.json`, JSON.stringify(metrics, null, 2));
const shot = await cdp('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: false,
});
fs.writeFileSync(`${out}/product-dialog-headless.png`, Buffer.from(shot.data, 'base64'));
console.log(JSON.stringify(metrics, null, 2));

ws.close();
proc.kill();
