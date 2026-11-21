# OpenAI pitches Itnig · Meet role-play evidence

This is a fictional pitch using public information. Set Meet captions to English. Say the company or product name in each factual sentence and pause between claims. Open **Sources** on the resulting cards to show the supporting or contradicting evidence.

```bash
npm run seed -- data/demo/meet-openai-itnig.json
```

| Script cue | Expected result | Evidence to show |
| --- | --- | --- |
| “OpenAI was publicly announced in December 2015 as a nonprofit research lab. Sam Altman and Elon Musk were its co-chairs.” | True. Use “was publicly announced” for a clear date check. | The public announcement is dated **December 11, 2015** and names both co-chairs. OpenAI’s later timeline dates the start as a nonprofit to **November 2015**. [Original announcement](https://openai.com/index/introducing-openai/) · [OpenAI timeline](https://openai.com/index/elon-musk-wanted-an-openai-for-profit/) |
| “OpenAI launched ChatGPT on November 30, 2022, as a free research preview.” | True | **November 30, 2022**. The announcement states that access was free during the preview. [ChatGPT launch](https://openai.com/index/chatgpt/) |
| “OpenAI launched GPT-5 in January 2025.” | False | GPT-5 launched on **August 7, 2025**. [GPT-5 launch](https://openai.com/index/introducing-gpt-5/) |
| “At DevDay 2025, Sam Altman announced that ChatGPT had 500 million weekly active users.” | False | OpenAI reported **more than 800 million weekly ChatGPT users** at DevDay 2025. [DevDay recap](https://openai.com/devday/2025/) · [Opening keynote](https://www.youtube.com/watch?v=hS1YqcewH0c) |
| “In October 2025, OpenAI’s nonprofit became the OpenAI Foundation. Its for-profit became a public benefit corporation, and the foundation kept control.” | True | The **October 28, 2025** structure names OpenAI Group PBC and gives the foundation control of its board. [OpenAI’s structure](https://openai.com/our-structure/) |
| “When the October 2025 recapitalization closed, Microsoft held about 27 percent of OpenAI Group.” | True for that date | Microsoft disclosed about **27% on an as-converted diluted basis** at closing. Its fiscal 2026 filing reports dilution, so keep the date in the line. [Microsoft’s recapitalization disclosure](https://www.sec.gov/Archives/edgar/data/789019/000119312525256310/msft-ex99_2.htm) · [Microsoft’s fiscal 2026 10-K](https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-20260630.htm) |
| “OpenAI has more than 4,000 employees.” | Neutral with this corpus | The corpus has no dated primary source for current company-wide headcount. |
| “I like the team.” / “This is the best moment to invest.” / “GPT-7 will make this round look cheap.” | Skip | Opinions and a prediction. |

The live conversation API extracted ten claims from the English role-play on November 21, 2026. Seven were true, two were false and the headcount was neutral. All nine true or false claims returned source links. The closing opinion and prediction produced no claims.
