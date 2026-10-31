import { PROVIDERS, PROVIDER_IDS } from '../lib/providers.js';
import { DEFAULT_PROMPT } from '../lib/prompt.js';
import { ObsidianClient, sharedEndpoints } from '../lib/obsidian.js';
import { getSettings, saveSettings } from '../lib/storage.js';

const $ = (sel) => document.querySelector(sel);
const vaultsEl = $('#vaults');

function addVaultRow(vault = { name: '', baseUrl: 'http://127.0.0.1:27123', apiKey: '' }) {
  const row = $('#vault-row').content.firstElementChild.cloneNode(true);
  for (const input of row.querySelectorAll('[data-field]')) input.value = vault[input.dataset.field] ?? '';
  const status = row.querySelector('[data-role="status"]');

  row.querySelector('[data-action="remove"]').addEventListener('click', () => row.remove());
  row.querySelector('[data-action="test"]').addEventListener('click', async () => {
    const v = readRow(row);
    status.className = 'status';
    status.textContent = 'Testing…';
    try {
      const { authenticated } = await new ObsidianClient(v).ping();
      status.className = `status ${authenticated ? 'ok' : 'error'}`;
      status.textContent = authenticated ? 'Connected ✓' : 'Reachable, but the API key was rejected.';
    } catch (err) {
      status.className = 'status error';
      status.textContent = err.message;
    }
  });
  vaultsEl.append(row);
}

function readRow(row) {
  const v = {};
  for (const input of row.querySelectorAll('[data-field]')) v[input.dataset.field] = input.value.trim();
  return v;
}

async function load() {
  const settings = await getSettings();
  $('#default-provider').append(
    ...PROVIDER_IDS.map((id) => new Option(PROVIDERS[id].label, id, false, id === settings.defaultProvider))
  );
  $('#default-tags').value = settings.defaultTags;
  $('#prompt').value = settings.prompt;
  settings.vaults.forEach(addVaultRow);
  if (!settings.vaults.length) addVaultRow();
}

async function save() {
  const saved = $('#saved');
  const vaults = [...vaultsEl.querySelectorAll('.vault')].map(readRow).filter((v) => v.name || v.apiKey);
  const names = vaults.map((v) => v.name);
  let error = '';
  if (vaults.some((v) => !v.name || !v.baseUrl || !v.apiKey)) error = 'Each vault needs a name, URL, and API key.';
  else if (new Set(names).size !== names.length) error = 'Vault names must be unique.';
  else if (!$('#prompt').value.includes('{{transcript}}')) error = 'The prompt must contain {{transcript}}.';
  if (error) {
    saved.className = 'status error';
    saved.textContent = error;
    return;
  }
  await saveSettings({
    vaults,
    prompt: $('#prompt').value,
    defaultProvider: $('#default-provider').value,
    defaultTags: $('#default-tags').value.trim(),
  });
  const shared = sharedEndpoints(vaults);
  if (shared.length) {
    saved.className = 'status error';
    saved.textContent =
      `Saved, but ${shared.map((g) => g.join(' & ')).join('; ')} use the same port. Only one of them is reachable ` +
      'while both vaults are open; give each vault its own port in Settings → Local REST API.';
    return;
  }
  saved.className = 'status ok';
  saved.textContent = 'Saved ✓';
  setTimeout(() => { saved.textContent = ''; }, 2000);
}

$('#add-vault').addEventListener('click', () => addVaultRow());
$('#reset-prompt').addEventListener('click', () => { $('#prompt').value = DEFAULT_PROMPT; });
$('#save').addEventListener('click', save);
load();
