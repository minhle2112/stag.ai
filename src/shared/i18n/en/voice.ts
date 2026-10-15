import type { EnNamespace } from '../types'
import type vi from '../vi/voice'

const en: EnNamespace<typeof vi> = {
  // Status (voice panel, floating overlay)
  'status.opening': 'Opening microphone…',
  'status.listening': 'Listening…',
  'status.fixing': 'Fixing with AI…',
  'status.processing': 'Recognizing…',
  'overlay.hint': 'press {key} to stop · Esc to cancel',
  'overlay.hotkey': 'the shortcut',

  // Voice panel in an agent cell
  'panel.stop': 'Stop speaking',
  'panel.speak': 'Speak to type',
  'panel.speakHold': 'Speak to type (or hold {key})',
  'panel.hint': 'release {key} (or click the mic button) to stop · Esc to cancel',
  'panel.hintLoading': 'loading model · release {key} (or click the mic button) to stop · Esc to cancel',
  'panel.loadingModel': 'Loading model (first use after a while)…',
  'panel.textLabel': 'Text recognized from speech',
  'panel.fixed': 'Fixed with AI',
  'panel.undo': 'Undo',
  'panel.previewHint': 'Edit if needed · hold {key} to add more · Shift+Enter for a new line · inserting doesn’t send',
  'panel.discard': 'Discard (Esc)',
  'panel.insert': 'Insert (Enter)',
  'panel.openSettings': 'Open Settings → Voice',
  'panel.retryInsert': 'Try inserting again',

  // A dictation turn
  'run.noTarget': 'Select an agent cell in the Agents tab, then hold the shortcut to speak.',
  'run.cloudFallbackLive': '({error} After you release the key, the on-device engine will recognize it.)',
  'run.noModel': 'The speech recognition model isn’t downloaded yet.',
  'run.micFailed': 'Couldn’t open the microphone: {message}. Check Windows Settings → Privacy → Microphone.',
  'run.cloudFallback': 'Soniox error: {error} Recognized with the on-device engine instead.',
  'run.failed': 'Recognition failed: {message}',
  'run.nothingRecognized': 'Couldn’t make out any words. Try speaking more clearly or closer to the mic.',
  'run.nothingHeard': 'Didn’t hear anything. Check the microphone in Settings → Voice.',
  'run.aiFailed': 'AI fix failed: {message}',
  'run.typeFailed': 'Couldn’t type into the open app: {message}',
  'run.noSession': 'This cell has no running session, so nothing was inserted. Start the session and try again.',

  // On-device model
  'model.extractFailed': 'Extraction failed: {message}',
  'model.serverError': 'The server returned error {status}.',
  'model.badChecksum': 'The download doesn’t match its checksum (it may have been corrupted). Try downloading again.',
  'model.missingFiles': 'The model package is missing files and can’t be used.',
  'engine.noModel': 'The speech recognition model isn’t downloaded yet (Settings → Voice).',
  'engine.notLoaded': 'The model isn’t loaded.',
  'engine.failed': 'Recognition error.',
  'engine.crashed': 'The recognition process exited unexpectedly (code {code}).',
  'engine.loadFailed': 'Couldn’t load the model: {message}',
  'engine.notRunning': 'The recognition process isn’t running.',
  'engine.timeout': 'Recognition took too long and was cancelled.',
  'engine.stopped': 'Recognition stopped.',

  // Soniox
  'cloud.badKey': 'The Soniox API key is wrong or has been revoked (Settings → Voice).',
  'cloud.noBalance': 'The Soniox account is out of credit or over its limit (console.soniox.com).',
  'cloud.rateLimited': 'Soniox is rate-limiting requests. Try again in a few seconds.',
  'cloud.error': 'Soniox error: {message}',
  'cloud.connectFailed': 'Couldn’t connect to Soniox (check your network).',
  'cloud.closed': 'Soniox closed the connection midway (code {code}).',
  'cloud.timeout': 'Soniox took too long to answer.',
  'cloud.cancelled': 'Cancelled.',
  'cloud.noKeyLong': 'No Soniox API key yet (Settings → Voice, stored in the secret {secret}).',
  'cloud.ended': 'The dictation turn has already ended.',
  'cloud.noKey': 'No Soniox API key yet.',

  // AI fix
  'ai.timeout': 'The AI took too long to answer.',
  'ai.callFailed': 'Couldn’t reach the AI: {message}',
  'ai.badKey': 'The Anthropic API key is wrong (Settings → Voice).',
  'ai.rateLimited': 'Anthropic is rate-limiting requests. Try again later.',
  'ai.error': 'AI error {status}: {message}',
  'ai.notAFix': 'The AI reply doesn’t look like a correction, so the original text was kept.',

  // Typing into other apps
  'keys.startFailed': 'Couldn’t start the key sender (PowerShell).',
  'keys.exited': 'The key sender exited.',
  'keys.notRunning': 'The key sender isn’t running.',
  'keys.noReply': 'The key sender isn’t responding.',
  'global.taken': '{key} is used by another app. Choose a different shortcut.',

  // Settings → Voice
  'settings.title': 'Voice',
  'settings.desc': 'Hold {key} in an agent cell to speak Vietnamese (mixed with English words), release to turn it into text.',
  'settings.descCloud': 'Using the Soniox cloud engine: audio is sent to Soniox for recognition and not stored by the app.',
  'settings.descLocal': 'Recognition runs entirely on your computer; audio is never sent anywhere or stored.',
  'settings.engine': 'Recognition engine',
  'settings.engineWhich': 'Engine',
  'settings.engineCloudDesc':
    'Soniox: text appears as you speak, usually more accurate with English words. Audio and the hint word list (file and function names) are sent to Soniox; terminal text is not.',
  'settings.engineLocalDesc': 'Qwen3-ASR runs entirely on your computer: free, works offline, audio never leaves the machine.',
  'settings.engineLocal': 'On device (Qwen3-ASR)',
  'settings.engineCloud': 'Cloud (Soniox)',
  'settings.usage': 'How to use',
  'settings.enable': 'Enable voice typing',
  'settings.enableDesc': 'Shortcut and mic button in the agent cell’s title bar.',
  'settings.hotkey': 'Shortcut',
  'settings.hotkeyDesc': 'Hold to speak, release to stop. Press Esc while speaking to cancel. Mic button on a cell: click to speak, click again to stop.',
  'settings.preview': 'Preview before inserting',
  'settings.previewDesc':
    'Shows the recognized text for editing; Enter inserts it into the cell. Off = insert directly. Neither sends anything: you still press Enter in the cell yourself.',
  'settings.sendCommand': 'Say "gửi" to send', // i18n-ignore: Vietnamese voice command words
  'settings.sendCommandDesc':
    'End with "gửi" or "gửi đi" → insert and press Enter right away (skips the preview). Saying just "gửi" → presses Enter for what’s already typed. Off by default because any sentence ending in "gửi" gets sent.', // i18n-ignore: Vietnamese voice command words
  'settings.ram': 'Memory (RAM)',
  'settings.unload': 'Unload model',
  'settings.unloadDesc':
    'The recognition process only runs while you speak (about 1.2–1.4 GB RAM). After a while unused it shuts down to free RAM; the next time you speak it reloads in about 2–3 seconds, mostly while you’re still talking.',
  'settings.unloadMinutes': { one: 'After {count} minute unused', other: 'After {count} minutes unused' },
  'settings.unloadHour': 'After 1 hour unused',
  'settings.unloadNever': 'Keep until the app closes',
  'settings.sonioxKey': 'Soniox API key',
  'settings.sonioxKeyHelp': 'Create a key at console.soniox.com → API keys and paste it here. The key is encrypted with your Windows account.',
  'settings.cost': 'Cost',
  'settings.costDesc':
    'Soniox charges about {rate} USD per hour of audio (the time you hold the key). This month: {minutes} min ≈ {usd} USD (counted by the app; see console.soniox.com for the real bill).',
  'settings.ai': 'AI fix (optional)',
  'settings.aiFix': 'Let AI fix misheard words',
  'settings.aiFixDesc':
    'After recognition, sends the sentence and the project word list to Claude ({model}) to fix misheard code terms, e.g. "hen đồ click" → handleClick. No audio or terminal text is sent. The preview shows the text right away and swaps in the AI fix when ready (with Undo). Each sentence costs about a hundredth of a cent.', // i18n-ignore: sample Vietnamese mis-hearing
  'settings.anthropicKey': 'Anthropic API key',
  'settings.anthropicKeyHelp': 'Create a key at console.anthropic.com → API keys. Shares the {secret} secret with connectors if you already have it.',
  'settings.global': 'Type into other apps',
  'settings.globalDesc':
    'When stag.ai isn’t in front: press {key} to speak, press again to stop (Windows doesn’t report key release for global shortcuts), Esc to cancel. The text is pasted into the focused field of that app (your clipboard is restored), with no preview and no automatic Enter. Can’t type into windows running as administrator.',
  'settings.globalHotkey': 'Global shortcut',
  'settings.globalHotkeyDesc': 'Inside stag.ai the hold-to-speak shortcut above still applies.',

  // API key field
  'key.savedOk': 'Key saved and tested: it works.',
  'key.saved': 'Saved (encrypted in the secret {secret}; the app won’t show it again). Paste a new key to replace it.',
  'key.savedPlaceholder': '•••••••• (saved)',
  'key.paste': 'Paste API key',
  'key.works': 'The key works.',
  'key.testing': 'Testing…',
  'key.test': 'Test',
  'key.removed': 'Key removed.',
  'key.remove': 'Remove key',

  // Recognition model
  'model.ready': 'Downloaded and ready (about 1 GB on disk).',
  'model.remove': 'Remove model',
  'model.verifying': 'Verifying the download…',
  'model.extracting': 'Extracting (about a minute)…',
  'model.missing': 'One-time download of {size} from GitHub (k2-fsa/sherpa-onnx). The app checks the SHA-256 before use.',
  'model.download': 'Download model',
  'model.titleFallback': 'On-device model (fallback, optional)',
  'model.title': 'Recognition model',

  'engineRow.label': 'Recognition process',
  'engineRow.ready': 'Loaded in RAM, recognizes as soon as you speak.',
  'engineRow.loading': 'Loading model…',
  'engineRow.off': 'Not running, uses no RAM.',
  'engineRow.unload': 'Unload now',

  // Microphone
  'mic.title': 'Microphone',
  'mic.default': 'Windows default microphone',
  'mic.numbered': 'Microphone {n}',
  'mic.unplugged': 'Selected microphone (not connected)',
  'mic.showNamesHint': 'Click "Show mic names" to see each microphone’s name.',
  'mic.showNames': 'Show mic names',

  // Hint words
  'hotwords.title': 'Hint words',
  'hotwords.auto': 'Suggest words from the workspace',
  'hotwords.autoDesc':
    'Project file, function, class and library names, code words visible in the agent cell, and common words (commit, push, npm…). Helps get English words spelled right. Reads local files only, nothing is sent anywhere.',
  'hotwords.manual': 'Your own words',
  'hotwords.manualDesc':
    'Always preferred: names, function names, libraries you say often (e.g. handleClick, zustand) — one per line, spelled exactly as you want them. Agent names are added automatically.',
  'terms.label': 'Words from workspace "{name}"',
  'terms.desc': 'Each time you speak, the app picks about 60 of the best-fitting words: yours, agent names, words visible in the cell, then workspace words.',
  'terms.scanning': 'Scanning…',
  'terms.list': { one: '{count} word, most important first: {terms}', other: '{count} words, most important first: {terms}' },
  'terms.none': 'No words found (empty folder or unreadable).',
  'terms.view': 'View',

  // Post-recognition fixes
  'fix.title': 'Fix text after recognition',
  'fix.newline': 'Say "xuống dòng" for a new line', // i18n-ignore: Vietnamese voice command words
  'fix.newlineDesc': '"…sửa hàm này, xuống dòng, rồi chạy test" → two lines. Saying "ký tự xuống dòng" or "dấu xuống dòng" keeps the words as text.', // i18n-ignore: Vietnamese voice command words
  'fix.newlineSwitch': 'New line command',
  'fix.rules': 'Replacement rules',
  'fix.rulesDesc':
    'For things the engine often mishears — one “engine output → what you want” per line, whole-phrase match, case-insensitive. Split function names (handle click) or wrong casing are fixed automatically from the hint words, no rule needed.'
}

export default en
