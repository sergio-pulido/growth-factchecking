// Offscreen document: holds the captured tab audio, keeps it audible, and streams it to OpenAI live
// transcription over WebRTC with a short-lived client secret minted by the local API.
// Spec: docs/specs/call-overlay.md#tab-audio
import type { OffscreenCommand, OffscreenEvent } from './messages.js';

const REALTIME_CALLS = 'https://api.openai.com/v1/realtime/calls';
const RECONNECT_MS = 2000;
const MAX_RECONNECTS = 3;

type Capture = {
  inputs: MediaStream[];
  /** Stream sent to OpenAI. Pausing it keeps the user's tab playback untouched. */
  send: MediaStream;
  playback: AudioContext;
  peer: RTCPeerConnection | null;
  stopping: boolean;
  reconnects: number;
};

let capture: Capture | null = null;
let generation = 0;

function emit(event: OffscreenEvent) {
  void chrome.runtime.sendMessage(event).catch(() => undefined);
}

function onRealtimeEvent(raw: string) {
  let event: { type?: string; item_id?: unknown; delta?: unknown; transcript?: unknown; error?: { message?: unknown } };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return;
  }
  const itemId = typeof event.item_id === 'string' ? event.item_id : '';
  switch (event.type) {
    // gpt-live-transcribe streams deltas into one open item and never completes it.
    case 'conversation.item.input_audio_transcription.delta':
      if (typeof event.delta === 'string' && event.delta) emit({ source: 'offscreen', kind: 'delta', itemId, text: event.delta });
      break;
    case 'conversation.item.input_audio_transcription.completed':
      if (typeof event.transcript === 'string' && event.transcript.trim()) {
        emit({ source: 'offscreen', kind: 'segment', itemId, text: event.transcript });
      }
      break;
    case 'error':
      console.warn('OpenAI live transcription error.', event.error);
      emit({ source: 'offscreen', kind: 'error', message: 'OpenAI could not transcribe the audio. Start a new check to try again.' });
      break;
    default:
      break;
  }
}

async function connect(current: Capture, token: string) {
  const peer = new RTCPeerConnection();
  current.peer = peer;
  const alive = () => !current.stopping && capture === current && current.peer === peer;
  for (const track of current.send.getAudioTracks()) peer.addTrack(track, current.send);
  const channel = peer.createDataChannel('oai-events');
  channel.addEventListener('message', (event) => {
    if (alive()) onRealtimeEvent(String(event.data));
  });
  peer.addEventListener('connectionstatechange', () => {
    if (current.stopping || capture !== current || current.peer !== peer) return;
    if (peer.connectionState === 'failed' || peer.connectionState === 'closed' || peer.connectionState === 'disconnected') {
      void reconnect(current);
    }
  });

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  const response = await fetch(REALTIME_CALLS, {
    method: 'POST',
    body: offer.sdp,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/sdp' },
  });
  if (!response.ok) {
    peer.close();
    throw new Error(`OpenAI rejected the live transcription (${response.status}).`);
  }
  const answer = await response.text();
  // Stopped while the call was being set up: do not leave an open connection behind.
  if (!alive()) {
    peer.close();
    return;
  }
  await peer.setRemoteDescription({ type: 'answer', sdp: answer });
}

async function reconnect(current: Capture) {
  current.peer?.close();
  current.peer = null;
  if (current.reconnects >= MAX_RECONNECTS) {
    emit({ source: 'offscreen', kind: 'error', message: 'The connection to the live transcription was lost.' });
    return;
  }
  current.reconnects += 1;
  await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
  if (current.stopping || capture !== current) return;
  try {
    // Client secrets expire after a few minutes: ask the background worker for a fresh one.
    const reply = await chrome.runtime.sendMessage<OffscreenEvent, { ok: boolean; token?: string }>(
      { source: 'offscreen', kind: 'token-needed' },
    );
    if (!reply?.ok || !reply.token) throw new Error('No transcription token.');
    if (current.stopping || capture !== current) return;
    await connect(current, reply.token);
    current.reconnects = 0;
  } catch {
    if (!current.stopping && capture === current) void reconnect(current);
  }
}

function stopStreams(streams: readonly MediaStream[]) {
  streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
}

async function start(streamId: string, token: string, microphone: boolean) {
  stop();
  const started = generation;
  const inputs: MediaStream[] = [];
  let playback: AudioContext | undefined;
  try {
    const tab = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    } as unknown as MediaStreamConstraints);
    inputs.push(tab);
    if (started !== generation) throw new Error('Listening stopped before it started.');

    // Restore playback as soon as Chrome takes over the tab. Only the tab audio is played back locally.
    playback = new AudioContext();
    const tabSource = playback.createMediaStreamSource(tab);
    tabSource.connect(playback.destination);
    let send: MediaStream;
    if (microphone) {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      inputs.push(mic);
      if (started !== generation) throw new Error('Listening stopped before it started.');
      const mix = playback.createMediaStreamDestination();
      tabSource.connect(mix);
      playback.createMediaStreamSource(mic).connect(mix);
      send = mix.stream;
    } else {
      send = new MediaStream(tab.getAudioTracks().map((track) => track.clone()));
    }
    const current: Capture = { inputs, send, playback, peer: null, stopping: false, reconnects: 0 };
    capture = current;
    await connect(current, token);
    if (started !== generation) throw new Error('Listening stopped before it started.');
  } catch (error) {
    if (started === generation && capture) stop();
    else {
      stopStreams(inputs);
      if (playback && playback.state !== 'closed') await playback.close();
    }
    throw error;
  }
}

function setMuted(muted: boolean) {
  for (const track of capture?.send.getAudioTracks() ?? []) {
    // A disabled track sends silence; the user keeps hearing the call through the original track.
    track.enabled = !muted;
  }
}

function stop() {
  generation++;
  const current = capture;
  if (!current) return;
  current.stopping = true;
  capture = null;
  current.peer?.close();
  stopStreams([current.send, ...current.inputs]);
  void current.playback.close();
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || typeof message !== 'object' || message === null
    || !('target' in message) || message.target !== 'offscreen') return;
  const command = message as OffscreenCommand;
  if (command.kind === 'microphone-status') {
    navigator.permissions.query({ name: 'microphone' as PermissionName }).then(
      ({ state }) => respond({ ok: true, permission: state }),
      () => respond({ ok: false }),
    );
    return true;
  }
  if (command.kind === 'start') {
    start(command.streamId, command.token, command.microphone).then(
      () => respond({ ok: true }),
      (error: unknown) => respond({ ok: false, message: error instanceof Error ? error.message : 'Could not capture the audio.' }),
    );
    return true;
  }
  if (command.kind === 'pause') setMuted(true);
  else if (command.kind === 'resume') setMuted(false);
  else if (command.kind === 'stop') stop();
  respond({ ok: true });
  return false;
});
