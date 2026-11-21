const enable = document.querySelector<HTMLButtonElement>('#enable')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;

enable.addEventListener('click', async () => {
  enable.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    status.textContent = 'Microphone enabled. Close this tab, return to Meet and press Start checking.';
  } catch (error) {
    status.textContent = error instanceof DOMException && error.name === 'NotFoundError'
      ? 'Chrome could not find a microphone. Connect one and try again.'
      : 'Microphone access failed. Check the microphone permission for FactCheck in Chrome and try again.';
    enable.disabled = false;
  }
});
