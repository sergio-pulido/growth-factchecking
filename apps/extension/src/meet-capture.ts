// Content script for https://meet.google.com/*. Loads idle: nothing is read until the user presses Start.
import type { ConversationCreateRequest, UtteranceInput } from '@growth-factcheking/shared';
import { createMeetCaptureController } from './meet/capture-controller.js';
import type { MeetCaptureController } from './meet/capture-controller.js';
import type { ApiResult, ConversationApi } from './meet/capture-session.js';
import type { BridgeMessage } from './meet/conversation-bridge.js';
import { readCaptionRows } from './meet/meet-captions-dom.js';
import { mountMeetPanel } from './meet/meet-panel.js';

declare global {
  interface Window {
    /** Public controller for UX/UI code running in the extension's isolated world on Meet. */
    growthMeetCapture?: MeetCaptureController & { showPanel(): void };
  }
}

async function send<T>(message: BridgeMessage): Promise<ApiResult<T>> {
  try {
    const response = (await chrome.runtime.sendMessage(message)) as ApiResult<T> | undefined;
    return response ?? { ok: false, status: 0, message: 'No response from the extension.' };
  } catch (error) {
    // Happens when the extension was reloaded: this page must be refreshed.
    return { ok: false, status: 0, message: error instanceof Error ? error.message : 'Extension unavailable' };
  }
}

const api: ConversationApi = {
  create: (body: ConversationCreateRequest) => send({ kind: 'conversation:create', body }),
  sendUtterances: (conversationId: string, utterances: readonly UtteranceInput[]) =>
    send({ kind: 'conversation:utterances', conversationId, utterances: [...utterances] }),
  end: (conversationId: string) => send({ kind: 'conversation:end', conversationId }),
};

function meetingMeta(): Omit<ConversationCreateRequest, 'platform' | 'capture'> {
  const language = document.documentElement.lang.slice(0, 2).toLowerCase();
  return {
    title: document.title.trim().slice(0, 300) || 'Google Meet',
    pageUrl: `${location.origin}${location.pathname}`,
    ...(/^[a-z]{2}$/.test(language) ? { language } : {}),
  };
}

function install(): void {
  if (window.growthMeetCapture) return;
  const controller = createMeetCaptureController({
    reader: { read: () => readCaptionRows(document) },
    api,
    scheduler: { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (h) => window.clearTimeout(h as number) },
    newIdPrefix: () => `meet-${crypto.randomUUID().slice(0, 8)}`,
    meta: meetingMeta,
  });
  const panel = mountMeetPanel(controller);
  window.growthMeetCapture = { ...controller, showPanel: panel.show };

  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'meet-capture:show-panel') {
      panel.show();
    }
  });

  // Leaving the call: stop reading and send what is pending. The background ends the conversation
  // if the tab closes before this completes.
  window.addEventListener('pagehide', () => {
    if (controller.getState().active) void controller.stop();
  });
}

install();
