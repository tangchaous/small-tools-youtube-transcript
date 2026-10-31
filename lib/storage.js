// chrome.storage wrappers. Settings and last-used choices live in storage.local;
// the running job, cached transcripts, and the last summary live in storage.session.
import { DEFAULT_PROMPT } from './prompt.js';

export const DEFAULT_SETTINGS = {
  vaults: [], // [{ name, baseUrl, apiKey }]; name should match the Obsidian vault name
  prompt: DEFAULT_PROMPT,
  defaultProvider: 'claude',
  defaultTags: 'youtube, summary',
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

export const saveSettings = (settings) => chrome.storage.local.set({ settings });

export async function getLastUsed() {
  const { lastUsed } = await chrome.storage.local.get('lastUsed');
  return lastUsed ?? null;
}

export const saveLastUsed = (lastUsed) => chrome.storage.local.set({ lastUsed });

export async function getJob() {
  const { job } = await chrome.storage.session.get('job');
  return job ?? null;
}

export const setJob = (job) => chrome.storage.session.set({ job: { ...job, updatedAt: Date.now() } });

export async function getCachedTranscript(videoId) {
  const key = `transcript:${videoId}`;
  return (await chrome.storage.session.get(key))[key] ?? null;
}

export const cacheTranscript = (videoId, value) => chrome.storage.session.set({ [`transcript:${videoId}`]: value });

export async function getLastResult() {
  const { lastResult } = await chrome.storage.session.get('lastResult');
  return lastResult ?? null;
}

export const saveLastResult = (lastResult) => chrome.storage.session.set({ lastResult });
