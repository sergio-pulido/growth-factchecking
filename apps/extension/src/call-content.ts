// FactCheck call overlay. On Meet, Zoom web, Teams web and YouTube videos it shows the pill as soon as a call or
// video is on screen and starts checking the captions right away, collapsed. On any other tab it opens in
// tab-audio mode when the user clicks the toolbar icon, because Chrome only allows tab capture after that click.
// Spec: docs/specs/call-overlay.md
import type { UtteranceBatchResult } from '@growth-factcheking/shared';
import { createAudioSource } from './call/audio-source.js';
import { createCaptionSource } from './call/caption-source.js';
import { isBatchResult, isClaimCheck, isFactCheckResult } from './call/http-transport.js';
import { mountCallPanel } from './call/panel.js';
import type { CallPanel } from './call/panel.js';
import { createMeetSource } from './call/meet-source.js';
import { MEET, platformOf } from './call/platforms.js';
import type { CaptionPlatform, CallPlatform } from './call/platforms.js';
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
    throw new CallTransportError('The extension was reloaded. Refresh this tab.');
  }
  if (!reply) throw new CallTransportError('The extension did not respond.');
  if (!reply.ok) throw new CallTransportError(reply.message, reply.code);
  return reply.result;
}

const transport: CallTransport = {
  async start(input) {
    const result = await relay({ kind: 'call-start', ...input });
    if (typeof result !== 'object' || result === null || !('id' in result) || typeof result.id !== 'string') {
      throw new CallTransportError('The local API did not return a conversation id.');
    }
    return { id: result.id };
  },
  async send(id, utterances): Promise<UtteranceBatchResult> {
    const result = await relay({ kind: 'call-send', id, utterances });
    if (!isBatchResult(result)) throw new CallTransportError('The local API returned invalid claims.');
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
    if (!isFactCheckResult(result)) throw new CallTransportError('The local API returned an invalid result.');
    return result;
  },
  async claims(id) {
    const result = await relay({ kind: 'call-claims', id });
    if (!Array.isArray(result) || !result.every(isClaimCheck)) throw new CallTransportError('The local API returned invalid claims.');
    return result;
  },
  badge(count) {
    void relay({ kind: 'call-badge', count }).catch(() => undefined);
  },
};

const pageTitle = () => document.title.trim().slice(0, 300) || location.hostname;

function mount(source: CaptureSource): CallPanel {
  const panel = mountCallPanel(source, transport, {
    // Captions need no permission prompt, so caption sources start on their own; tab audio waits for the click.
    autoStart: source.capture === 'captions',
    title: pageTitle,
    // Origin and path only: query strings and fragments can carry personal data.
    pageUrl: () => `${location.origin}${location.pathname}`,
    onCheckSelection: mountOverlay,
  });
  window.growthFactCheckingCall = panel;
  return panel;
}

function captionSource(platform: CallPlatform | CaptionPlatform): CaptureSource {
  return platform === MEET ? createMeetSource() : createCaptionSource(platform as CaptionPlatform);
}

/** Shows or removes the pill on call apps as the user joins or leaves a call. */
function sync() {
  const platform = platformOf(location);
  const panel = window.growthFactCheckingCall;
  if (!platform || panel?.capture === 'audio') return;
  const inCall = platform.isCall(location, document);
  if (inCall && !panel) mount(captionSource(platform));
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
