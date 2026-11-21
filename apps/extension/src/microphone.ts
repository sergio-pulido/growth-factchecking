import { icon } from './call/dom.js';

const setup = document.querySelector<HTMLElement>('.setup')!;
const title = document.querySelector<HTMLHeadingElement>('#title')!;
const description = document.querySelector<HTMLParagraphElement>('#description')!;
const microphoneMark = document.querySelector<HTMLElement>('.microphone-mark')!;
const enable = document.querySelector<HTMLButtonElement>('#enable')!;
const enableLabel = document.querySelector<HTMLElement>('#enable-label')!;
const back = document.querySelector<HTMLButtonElement>('#back')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;

document.querySelector('.brand-mark')?.append(icon('check'));
microphoneMark.append(icon('mic'));
enable.querySelector('.button-icon')?.append(icon('mic'));

function showReady() {
  setup.dataset.state = 'ready';
  title.textContent = 'Microphone enabled';
  description.textContent = 'Return to your call and select Start checking to begin the transcription.';
  microphoneMark.replaceChildren(icon('check'));
  status.textContent = 'Chrome granted microphone access.';
  enable.hidden = true;
  back.hidden = false;
  back.focus();
}

enable.addEventListener('click', async () => {
  enable.disabled = true;
  setup.dataset.state = 'requesting';
  enableLabel.textContent = 'Waiting for Chrome…';
  status.textContent = 'Select Allow in the Chrome prompt.';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    showReady();
  } catch (error) {
    setup.dataset.state = 'error';
    status.textContent = error instanceof DOMException && error.name === 'NotFoundError'
      ? 'Chrome could not find a microphone. Connect one and try again.'
      : 'Microphone access failed. Check the microphone permission for FactCheck in Chrome and try again.';
    enableLabel.textContent = 'Try again';
    enable.disabled = false;
  }
});

back.addEventListener('click', async () => {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.openerTabId !== undefined) {
      await chrome.tabs.update(tab.openerTabId, { active: true });
      if (tab.id !== undefined) await chrome.tabs.remove(tab.id);
      return;
    }
  } catch (error) {
    console.info('FactCheck could not return to the original Meet tab.', error);
  }
  status.textContent = 'Switch back to your Meet tab and select Start checking.';
});
