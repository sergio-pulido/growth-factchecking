import assert from 'node:assert/strict';
import test from 'node:test';

class Track {
  enabled = true;
  stopped = false;
  clone() { return new Track(); }
  stop() { this.stopped = true; }
}

class Stream {
  constructor(tracks = [new Track()]) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}

let onCommand;
globalThis.chrome = { runtime: { id: 'test-extension', onMessage: { addListener(fn) { onCommand = fn; } } } };
globalThis.MediaStream = Stream;
await import('../test-dist/offscreen.js');

const send = (kind, fields) => new Promise((resolve) => {
  onCommand({ target: 'offscreen', kind, ...fields }, { id: chrome.runtime.id }, resolve);
});

test('Meet sends microphone and tab audio in one stream and plays only the tab locally', async (t) => {
  const tab = new Stream();
  const mic = new Stream();
  const mix = { stream: new Stream() };
  const playback = {};
  const media = t.mock.method(globalThis, 'navigator', {
    getter: true,
  });
  media.mock.mockImplementation(() => ({
    mediaDevices: { async getUserMedia({ audio }) { return 'mandatory' in audio ? tab : mic; } },
    permissions: { async query() { return { state: 'granted' }; } },
  }));
  const connections = [];
  const sent = [];
  globalThis.AudioContext = class {
    destination = playback;
    createMediaStreamSource(stream) { return { connect(to) { connections.push([stream, to]); } }; }
    createMediaStreamDestination() { return mix; }
    async close() {}
  };
  globalThis.RTCPeerConnection = class {
    addTrack(track) { sent.push(track); }
    createDataChannel() { return new EventTarget(); }
    addEventListener() {}
    async createOffer() { return { sdp: 'offer' }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() {}
  };
  t.mock.method(globalThis, 'fetch', async () => new Response('answer'));
  t.after(() => send('stop'));

  assert.deepEqual(await send('microphone-status'), { ok: true, permission: 'granted' });
  assert.deepEqual(await send('start', { streamId: 'tab', token: 'test', microphone: true }), { ok: true });
  assert.deepEqual(connections, [[tab, playback], [tab, mix], [mic, mix]]);
  assert.deepEqual(sent, mix.stream.getTracks());
  await send('pause');
  assert.equal(sent[0].enabled, false);
  assert.equal(tab.tracks[0].enabled, true);
  await send('resume');
  assert.equal(sent[0].enabled, true);
  await send('stop');
  assert.ok([tab, mic, mix.stream].every((stream) => stream.tracks.every((track) => track.stopped)));

  const microphoneOnly = new Stream();
  media.mock.mockImplementation(() => ({
    mediaDevices: { async getUserMedia({ audio }) {
      assert.equal('mandatory' in audio, false);
      return microphoneOnly;
    } },
  }));
  assert.deepEqual(await send('start', { token: 'test', microphone: true }), { ok: true });
  assert.equal(connections.length, 3);
  assert.equal(sent.at(-1), microphoneOnly.tracks[0]);
  await send('stop');
  assert.equal(microphoneOnly.tracks[0].stopped, true);
});
