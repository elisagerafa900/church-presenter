# Church Presenter

Free, open-source scripture presenter for churches: EasyWorship-style Bible search,
projector + NDI + OBS outputs, and **live sermon transcription that detects scriptures**
(named or quoted) — online with your own Deepgram key, or fully offline and free.

**Download:** installers are on the [Releases page](https://github.com/elisagerafa900/church-presenter-releases/releases).
Licence: MIT (see `LICENSE`).

Scripture presenter for the church projector and livestream. Live sermon transcription and
automatic verse detection come in Phases 3–4.

## What works now
- **4 Bibles, offline:** KJV, WEB (World English Bible, "LORD" edition), BSB (Berean Standard Bible),
  ASV — all public domain.
- **YouVersion online Bibles** (Bible menu → *+ Add Bible…* → *YouVersion (online)*): paste your own
  YouVersion Platform **App Key** (platform.youversion.com), pick the versions your key is licensed for
  (e.g. NIV, NKJV) and they appear in the Bible menu. Needs internet; chapters are fetched as you use
  them; the publisher's copyright line is shown on screen.
  **Offline copy (opt-in per version):** switch on *Keep an offline copy* only if that version's licence
  allows it. Chapters you open (or *Download all*) are stored **encrypted for the Windows user**, used
  when there is no internet, re-checked with YouVersion when online, and deleted if access ends or it
  isn't re-checked for 60 days. Word search and
  quoted-verse detection use the built-in Bibles.
- **Import a Bible** (Bible menu → *+ Add Bible…* → *From a file*): load a translation your church is licensed to use
  (e.g. NIV / NKJV with the publisher's permission). Reads **Zefania XML, OSIS, USFX, JSON, CSV/TSV**.
  Imported Bibles stay on that PC and survive updates. Please don't commit licensed texts to the repo.
- **Smart search box:** type `john 3:16`, `jn 3 16`, `1 cor 13 4-7`, `ps 23`, `phil 4 13`,
  or words like `faith hope love`. A range (`4-7`) goes straight into the queue.
- **Book list, chapter chips, verse list.** Click = preview, double-click = put on screen.
- **Preview → Present**, **Queue**, **Prev / Next** verse.
- **GO LIVE** opens a full-screen projector window on the screen you pick (top right).
- **BLACK** (black screen) and **CLEAR** (hide text, keep background).
- **Themes:** Midnight, Royal, Ember, Forest, Plain black, Light, or **your own image**.
- **Livestream lower third:** OBS/vMix *Browser source* → `http://localhost:4317/output.html?layout=lower`
  (transparent background) or `?layout=full`. Click **Outputs** in the app for the exact addresses,
  including the one to use from another PC on the same network.

### Keyboard
| Key | Action |
|---|---|
| `/` or `Ctrl+F` | Search |
| `↑` `↓` | Pick verse (preview) |
| `Enter` | Put preview on screen |
| `→` `Space` `PageDown` | Next verse on screen |
| `←` `PageUp` | Previous verse on screen |
| `B` | Black screen on/off |
| `C` | Clear text on/off |

## NDI output (Phase 2)
1. **One time, on your build PC:** put `Processing.NDI.Lib.x64.dll` (from the free NDI SDK) into
   `vendor/ndi/` — steps in `vendor/ndi/README.txt`. The installer from `npm run dist` bundles it,
   so church PCs need **no NDI installation** (same as EasyWorship).
2. Start Church Presenter → **Outputs** → switch on **Full screen** and/or **Lower third**.
3. In vMix: *Add Input → NDI* → pick `YOUR-PC (Church Presenter Main)`.
   In OBS: install the *DistroAV* (obs-ndi) plugin, then *Add Source → NDI Source*.
- The lower third is sent **with transparency**, so it sits over the camera with no green screen.
- Frames are only sent when a receiver is connected, and only re-sent when the verse changes
  (plus once a second), so it is light on the laptop.
- The **NDI** badge on the Outputs button turns green when someone is watching.

## Live transcription
**Bring your own Deepgram key** — the app has no key built in. Each PC keeps its own key.
1. Make a free account at https://console.deepgram.com and create an **API key**.
2. In the app: **Live sermon** → ⚙ → paste the key → **Save** (it is checked first).
   Use **change** / **remove** any time. Or choose **Offline · free** and skip Deepgram entirely.
3. Pick the microphone (the mixer / pulpit mic feed is best), press **Start listening**.
- The sermon appears as text. Scriptures the preacher names ("John chapter three verse sixteen",
  "Romans 8", "and verse 17…") appear under **Detected scriptures** with **Present** / **Queue** buttons.
- On another tab? A popup appears bottom-left and the Live tab shows a red count.
- Optional: *Put detected verses on screen automatically* (only 95% matches).
- If the internet drops, it reconnects by itself.
- **Cloud** = Deepgram Nova-3 (most accurate, paid per minute after the free credit).
- **Offline · free** = runs on this PC, no internet, no cost (Phase 4):
  Live → ⚙ → *Offline · free* → **Download** a model:
  - *Accurate — Parakeet* (~480 MB download, ~1.2 GB memory) — recommended
  - *Light — Moonshine Tiny* (~110 MB) — for weaker PCs
  If the download fails, use the browser link shown and **from file…** to install it.
- **Quoted verses** (Phase 4): when the preacher quotes a verse without naming it
  ("I can do all things through Christ…"), it is detected and marked *quoted* (50–89%).

## Run it on Windows
1. Install **Node.js LTS** from https://nodejs.org (accept the defaults).
2. Unzip this folder somewhere, e.g. `C:\ChurchPresenter`.
3. Open the folder, click the address bar, type `cmd`, press Enter.
4. Run once: `npm install`
5. Start the app: `npm start`
   - For development with instant reload: `npm run dev`
6. Make an installer (`.exe` in the `release` folder): `npm run dist`

Connect the projector by HDMI and set Windows to **Extend** these displays (`Win + P` → Extend),
then pick that screen in the app and press **GO LIVE**.

## Contributing
Pull requests are welcome.
```
npm.cmd install     # first time
npm.cmd run dev     # app with instant reload
npm.cmd test        # parser + detector tests
```
For NDI while developing, put `Processing.NDI.Lib.x64.dll` in `vendor/ndi/` (see the README there).
Please don't commit that DLL, API keys, or copyrighted Bible texts (NIV, NKJV, …).

## Releasing updates (GitHub)
Installers are published to the public repo **elisagerafa900/church-presenter-releases**.
Church PCs check it when the app starts (and every 4 hours), download new versions in the
background, and install when the app is closed — or when the operator clicks
**"Update … ready — restart"** in the bottom bar.

Each new version:
1. In `package.json` raise `"version"` (e.g. `0.1.0` → `0.2.0`). It must always go up.
2. In PowerShell in this folder:
   ```
   $env:GH_TOKEN="your-github-token"
   $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
   $env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
   npm.cmd run release
   ```
3. Done — the release appears on GitHub and PCs pick it up.

Token: GitHub → Settings → Developer settings → Fine-grained tokens → only the
`church-presenter-releases` repo → Permissions: **Contents: Read and write**. Keep it private.

## Project layout
```
electron/main.cjs     windows, projector output, web server for OBS (port 4317)
electron/preload.cjs  safe bridge between app and Electron
electron/ndi.cjs      NDI sender (calls the NDI runtime through koffi)
src/App.jsx           operator screen
src/Slide.jsx         verse renderer (1920×1080, auto-fit text) used by every output
src/output.jsx        projector / browser-source page
src/bible.js          Bible loading + word search
src/themes.js         backgrounds
shared/bibleRef.js    scripture reference parser (typed + spoken), reused for live detection
shared/detector.js    finds scriptures in the live transcript
electron/stt.cjs      Deepgram live streaming (main process)
src/audio.js          microphone capture (16 kHz PCM)
src/LivePanel.jsx     Live sermon panel
electron/offline-stt.cjs  free offline transcription (sherpa-onnx + Silero VAD)
electron/models.cjs   offline model download / install
shared/quotes.js      quoted-verse matching
shared/bibleImport.js reads Bible files (Zefania, OSIS, USFX, JSON, CSV/TSV)
electron/bibles.cjs   stores imported Bibles on the PC
electron/youversion.cjs  YouVersion Platform API (App Key header, versions, index, chapters)
electron/yvcache.cjs  encrypted offline copies (Electron safeStorage)
electron/yvoffline.cjs   offline rules: saved-first chapters, licence re-check, Download all
src/youversion.js     online Bibles in the menu, fetch-on-demand
shared/yvHtml.js      splits YouVersion chapter HTML into verses
tools/make-web.mjs    builds WEB.json (LORD edition) from the public-domain USFX
shared/*.test.js      `npm test`
public/bibles/*.json  KJV, BSB, ASV
```

## Ideas for later
- Meaning search for loose paraphrases (AI embeddings)
- Stage display for the pastor, transcript export, local languages / pidgin
