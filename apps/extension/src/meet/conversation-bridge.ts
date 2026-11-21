// Background side of Meet capture. The Meet content script cannot call the local API from the meet.google.com
// origin, so it asks the service worker, which holds the host permission for 127.0.0.1.
import { CONVERSATIONS_PATH } from '@growth-factcheking/shared';
import type { ApiResult } from './capture-session.js';

export const API_ORIGIN = 'http://127.0.0.1:3000';
const STORAGE_KEY = 'meetCaptureConversations';

export type BridgeMessage =
  | { kind: 'conversation:create'; body: Record<string, unknown> }
  | { kind: 'conversation:utterances'; conversationId: string; utterances: unknown[] }
  | { kind: 'conversation:end'; conversationId: string };

const ID = /^[0-9a-f-]{36}$/i;

export function isBridgeMessage(message: unknown): message is BridgeMessage {
  if (typeof message !== 'object' || message === null || !('kind' in message)) return false;
  const m = message as Record<string, unknown>;
  switch (m.kind) {
    case 'conversation:create':
      return typeof m.body === 'object' && m.body !== null;
    case 'conversation:utterances':
      return typeof m.conversationId === 'string' && ID.test(m.conversationId) && Array.isArray(m.utterances);
    case 'conversation:end':
      return typeof m.conversationId === 'string' && ID.test(m.conversationId);
    default:
      return false;
  }
}

async function call<T>(path: string, body: unknown, timeoutMs: number): Promise<ApiResult<T>> {
  try {
    const response = await fetch(new URL(path, API_ORIGIN), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : null;
    if (response.ok) return { ok: true, data: data as T };
    const message = typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string'
      ? data.message
      : `HTTP ${response.status}`;
    return { ok: false, status: response.status, message };
  } catch (error) {
    return { ok: false, status: 0, message: error instanceof Error ? error.message : 'Network error' };
  }
}

async function tabConversations(): Promise<Record<string, string>> {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as Record<string, string> | undefined) ?? {};
}

async function rememberTab(tabId: number, conversationId: string | null): Promise<void> {
  const current = await tabConversations();
  const { [String(tabId)]: _removed, ...rest } = current;
  await chrome.storage.session.set({ [STORAGE_KEY]: conversationId ? { ...rest, [String(tabId)]: conversationId } : rest });
}

export async function handleBridgeMessage(message: BridgeMessage, tabId: number): Promise<ApiResult<unknown>> {
  switch (message.kind) {
    case 'conversation:create': {
      const result = await call<{ id: string }>(CONVERSATIONS_PATH, message.body, 5000);
      if (result.ok) await rememberTab(tabId, result.data.id);
      return result;
    }
    case 'conversation:utterances':
      // Extraction plus fact-checks can take several seconds per batch.
      return call(`${CONVERSATIONS_PATH}/${message.conversationId}/utterances`, { utterances: message.utterances }, 30_000);
    case 'conversation:end': {
      const result = await call(`${CONVERSATIONS_PATH}/${message.conversationId}/end`, {}, 5000);
      if (result.ok || result.status === 404) await rememberTab(tabId, null);
      return result.ok ? { ok: true, data: null } : result;
    }
  }
}

/** Opens the Meet panel; injects the content script first when the tab predates the extension install. */
export async function showMeetPanel(tabId: number): Promise<void> {
  const message = { kind: 'meet-capture:show-panel' };
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['meet-capture.js'] });
    await chrome.tabs.sendMessage(tabId, message);
  }
}

/** Registers the message handler and ends a tab's open conversation when the tab is closed. */
export function registerConversationBridge(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || !isBridgeMessage(message)) return;
    void handleBridgeMessage(message, sender.tab.id).then(respond, (error: unknown) => {
      respond({ ok: false, status: 0, message: error instanceof Error ? error.message : 'Bridge error' });
    });
    return true;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void tabConversations().then(async (map) => {
      const conversationId = map[String(tabId)];
      if (!conversationId) return;
      await call(`${CONVERSATIONS_PATH}/${conversationId}/end`, {}, 5000);
      await rememberTab(tabId, null);
    });
  });
}
