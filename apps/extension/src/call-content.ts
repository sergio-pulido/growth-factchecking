// FactCheck call overlay. Runs on Meet, Zoom web and Teams web (shows the pill once a call is on screen) and
// on any other tab when the user clicks the toolbar icon. Nothing is read until "Empezar a verificar".
// Spec: docs/specs/call-overlay.md
import type { UtteranceBatchResult } from '@growth-factcheking/shared';
import { createAudioSource } from './call/audio-source.js';
import { createCaptionSource } from './call/caption-source.js';
import { isBatchResult, isFactCheckResult } from './call/http-transport.js';
import { mountCallPanel } from './call/panel.js';
import type { CallPanel } from './call/panel.js';
import { platformOf } from './call/platforms.js';
import { CallTransportError } from './call/types.js';
import type { CallTransport, CaptureSource } from './call/types.js';
import type { CallReply, CallRequest } from './messages.js';
import { mountOverlay } from './overlay.js';

declare global {
  interface Window {
    growthFactCheckingCall?: CallPanel;
    /** Set by the running copy of this script; false once the extension was reloaded under it. */
    growthFactCheckingCallAlive?: () => boolean;
  }
}

async function relay(request: CallRequest): Promise<unknown> {
  let reply: CallReply | undefined;
  try {
    reply = await chrome.runtime.sendMessage<CallRequest, CallReply>(request);
  } catch {
    throw new CallTransportError('La extensión se ha recargado. Actualiza esta pestaña.');
  }
  if (!reply) throw new CallTransportError('La extensión no respondió.');
  if (!reply.ok) throw new CallTransportError(reply.message, reply.code);
  return reply.result;
}

const transport: CallTransport = {
  async start(input) {
    const result = await relay({ kind: 'call-start', ...input });
    if (typeof result !== 'object' || result === null || !('id' in result) || typeof result.id !== 'string') {
      throw new CallTransportError('La API local no devolvió un identificador de conversación.');
    }
    return { id: result.id };
  },
  async send(id, utterances): Promise<UtteranceBatchResult> {
    const result = await relay({ kind: 'call-send', id, utterances });
    if (!isBatchResult(result)) throw new CallTransportError('La API local devolvió afirmaciones inválidas.');
    return result;
  },
  async end(id) {
    await relay({ kind: 'call-end', id });
  },
  async remove(id) {
    await relay({ kind: 'call-remove', id });
  },
  async recheck(claim) {
    const result = await relay({ kind: 'call-recheck', claim });
    if (!isFactCheckResult(result)) throw new CallTransportError('La API local devolvió un resultado inválido.');
    return result;
  },
  badge(count) {
    void relay({ kind: 'call-badge', count }).catch(() => undefined);
  },
};

const pageTitle = () => document.title.trim().slice(0, 300) || location.hostname;

function mount(source: CaptureSource): CallPanel {
  const panel = mountCallPanel(source, transport, {
    title: pageTitle,
    // Origin and path only: query strings and fragments can carry personal data.
    pageUrl: () => `${location.origin}${location.pathname}`,
    onCheckSelection: mountOverlay,
  });
  window.growthFactCheckingCall = panel;
  return panel;
}

/** Shows or removes the pill on call apps as the user joins or leaves a call. */
function sync() {
  const platform = platformOf(location);
  const panel = window.growthFactCheckingCall;
  if (!platform || panel?.capture === 'audio') return;
  const inCall = platform.isCall(location, document);
  if (inCall && !panel) mount(createCaptionSource(platform));
  else if (!inCall && panel) {
    panel.destroy();
    window.growthFactCheckingCall = undefined;
  }
}

/** Toolbar icon: open the overlay, in captions mode on a call app and in tab-audio mode anywhere else. */
function toggle() {
  sync();
  if (!window.growthFactCheckingCall) {
    mount(createAudioSource((request) => relay(request))).open();
    return;
  }
  window.growthFactCheckingCall.toggle();
}

// The toolbar can inject this script into a tab where the manifest already did: run it once. After an extension
// reload the old copy is orphaned (its chrome APIs are gone): replace it.
if (!window.growthFactCheckingCallAlive?.()) {
  window.growthFactCheckingCall?.destroy();
  window.growthFactCheckingCall = undefined;
  window.growthFactCheckingCallAlive = () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  };
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'call-toggle') toggle();
  });
  // Call apps are single-page apps: the call appears without a page load.
  window.setInterval(sync, 1000);
  sync();
}
