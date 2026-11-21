# YouTube tab audio — real extension run, 2026-11-21

Video: [Castilla y León Televisión, "Subida del SMI a 1.286 € y sueldos públicos un 5 % en 2027"](https://www.youtube.com/watch?v=VhiCa_4wmsU), 69 s, Spanish.
Corpus: the demo snapshot plus `data/demo/video-smi.json` (2.7 million / 13.6% reach; 4.5% for 2027 and the conditional 0.5% for 2026).

## Evidence level

- **Run on a real stack, by the Claude Code agent**: the unpacked extension in Chrome for Testing 148, the real YouTube page,
  `chrome.tabCapture`, the offscreen document, OpenAI live transcription (`gpt-live-transcribe`, Spanish hint), the local API
  with claim extraction and the live pipeline on Postgres. The first runs opened the overlay with the action's keyboard
  shortcut, which grants `activeTab` the same way a toolbar click does (added only in a scratch copy of `dist`). The headless run
  sent the toolbar click's message from the service worker instead, with `--allowlisted-extension-id` and a scratch YouTube host
  permission.
- Two manual runs in a regular Chrome, made on the same API at the same time, are summarised below.
- Not **verified** under the Alodai definition (a human-confirmed run with this file).

## Bug found: words glued to numbers

The live model sends a lone `" "` delta before a number (`" al"`, `" "`, `"13"`, `","`, `"6"`, `"%"`). `takeSentences` trimmed the
unfinished rest after every delta, dropped that space, and the transcript read "al13,6%", "crece65", "de2027". `main` fixed it
in parallel in `46b5da1` (the rest keeps its trailing whitespace); `test/segmenter.test.mjs` now replays these deltas.

## YouTube back on tab audio (0.5.3)

0.5.0 switched YouTube to reading the player's captions. In the manual runs on 0.5.0–0.5.2 it sent YouTube's own notice
("Spanish (auto-generated)", "Click for settings") as speech, split each word-by-word caption update into its own utterance
("hoy nos convertimos", "hoy nos convertimos en el…"), and lost the middle of this clip ("A", "A partir", "A partir del 1 de
enero", then nothing until 0:46). It also read the captions of a pre-roll ad. 0.5.3 puts YouTube back on tab audio, which the
results below come from: click the toolbar icon, pick the language, Start checking.

## Results

The YouTube player stops at about 0:30–0:36 under automation, with "Se ha producido un error". It does this with FactCheck off
too, so it is not caused by the extension. Hiding the automation flags lets the windowed run play to the end.

Five agent runs (Español selected) and four manual runs in a regular Chrome, made on the same API at the same time.
"Heard as" marks a transcription mistake.

| Sentence | Agent runs | Manual runs |
| --- | --- | --- |
| €65 a month, €910 a year | True ×3 (two runs started after it) | True ×3 |
| 13.6% of employees, 2.7 million | True ×5 | True ×2, Likely true ×1, False ×1 (heard as "3,6%") |
| 5.3%, to €1,286 in 14 payments | True ×4 | True ×2, False and Likely false (heard as "1.266" ×2) |
| A decree exempts it from income tax | Likely true ×2, Neutral ×2 | Neutral ×4 |
| No income tax from the first 2027 payslip | True ×3 | True ×3, Likely false ×1 (heard as "2017") |
| Deduction tapers off up to €23,172 | Likely true ×1 (heard as "23.100"); cut off in the others | True ×2, False ×1 (heard as "27.182") |
| Civil servants paid 5% more next year | not reached | Neutral ×2 |
| Half a point of it for inflation | not reached | Likely false ×1, Likely true ×1 (wording differed) |

Timing from the database (runs `ce73fd62`, `2db8401e`, `ff750eab` and the headless run): a sentence reaches the API a median
1.3 s after the segmenter cuts it, and its verdict is stored a median 2.0–2.8 s later (max 3.8 s) for extraction plus the
live check. The cut itself waits for the next word, or 1.5 s of quiet.

## Open items

1. Mishearings of figures in live transcription produce confident false verdicts. A per-conversation vocabulary hint, or
   showing the heard transcript next to the claim, would make them visible.
2. "El decreto establece deducciones también a los siguientes tramos fiscales" is extracted although it is not checkable on
   its own.
