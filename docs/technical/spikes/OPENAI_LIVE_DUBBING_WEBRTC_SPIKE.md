# Phase D Spike: OpenAI Realtime Translation over WebRTC

Status: **SPIKE_DEFERRED** (no live key available; nothing observed on a real call).
Branch: `feat/live-dubbling`. Isolated spike only — delete the `spikes/openai/`
tree to remove it. Do not commit (validation owner: spike author).

## 1. Goal

Determine whether OpenAI Realtime Translations (`gpt-realtime-translate`)
can deliver usable live-dubbed audio over a WebRTC peer connection fed by the
extension's existing tab-capture output, without disturbing the production
Gemini live-dubbing path.

## 2. Non-goals / isolation contract

- No changes to the provider registry (`LiveDubbingProviderRegistry.js`), UI
  selection wiring, `LiveDubbingCoordinator`, `LiveDubbingController`,
  `TabAudioPipeline`, `PcmOutputPlayer`, or any Gemini adapter/behavior.
- No new storage keys or settings. No rotation/failover system.
- The only production file touched is
  `src/shared/runtime/OffscreenRuntimeLeaseManager.js` (added the generic
  `WEB_RTC` offscreen reason + justification wording), plus its test.
- Spike code lives under `src/features/live-dubbing/spikes/openai/` and is
  never imported by production code (verified by test: no spike import
  outside the spike tree).

## 3. Official API (followed verbatim)

Mint (Background-only):

```text
POST https://api.openai.com/v1/realtime/translations/client_secrets
Authorization: Bearer OPENAI_API_KEY
Content-Type: application/json

{
  "expires_after": { "anchor": "created_at", "seconds": 600 },
  "session": {
    "model": "gpt-realtime-translate",
    "audio": {
      "input": {
        "transcription": { "model": "gpt-realtime-whisper" },
        "noise_reduction": null
      },
      "output": { "language": "<target>" }
    }
  }
}
```

Response is JSON: `{ "value": "ek_...", "expires_at": <epoch>, "session": {...} }`.
Only `value` is extracted; the scalar `expires_at` may be reported as a
diagnostic (`expiresAt`, number or null). The secret is never persisted,
logged, thrown, or stored.

SDP exchange:

```text
POST https://api.openai.com/v1/realtime/translations/calls
Authorization: Bearer <client secret>
Content-Type: application/sdp

<body> = offer.sdp as raw text
```

The response body is raw SDP answer text (NOT JSON) and is applied via
`setRemoteDescription({ type: 'answer', sdp })`.

Data channel `oai-events`: transcript events are counted only. Transcript
text is never logged, persisted, or displayed — only the scalar counter and
the `firstTranscriptEvent` milestone leave the handler.

## 4. Local seams used (exact)

- Keys: `ApiKeyManager.getKeys('OPENAI_API_KEY')`
  (`src/features/translation/providers/ApiKeyManager.js:108`), setting
  `OPENAI_API_KEY` (`src/shared/config/config.js:187`), helper
  `getOpenAIApiKeysAsync` (`src/shared/config/config.js:1274-1277`). Spike
  default is `() => ApiKeyManager.getKeys('OPENAI_API_KEY')`.
- Key behavior: **single-key reuse**. Only the first eligible key is used;
  any mint failure resolves to `null` with no next-key attempt. There is no
  rotation, promotion, or legacy fallback. Reported here as specified.
- Proxy: identical pattern to `GeminiLiveBootstrapService._fetch`
  (lines 262–268) — injectable `fetchImpl` for tests, otherwise
  `resolveProxyConfig()` + `proxyManager.fetch(url, options, config)` on a
  single path with no silent direct-`fetch` retry. Applies to both the mint
  and the SDP POST.
- Offscreen: added `'WEB_RTC'` to `OFFSCREEN_DOCUMENT_REASONS`
  (`OffscreenRuntimeLeaseManager.js:7-11`) and extended the shared-document
  justification to name WebRTC peer connections. No provider coupling (no
  OpenAI/live-dubbing naming in the lease manager). Lease tests updated at
  `:84` (created-document reasons) and `:662` (`WEB_RTC` single/multi-reason
  support below Chromium 116).
- Capture reuse: `LiveDubbingCoordinator._startTransaction` lines 451–526
  are the manual-path reference only (lease acquire → PREPARE →
  `getMediaStreamId` → CONSUME → MEDIA_ACQUIRED). The transport input stays
  browser-neutral — `{ sourceStream|sourceAudioTrack, targetLanguage,
  bootstrap }` — and uses only `MediaStream`/`MediaStreamTrack`/
  `RTCPeerConnection`/`RTCDataChannel`/audio-element playback. It never
  imports browser capture APIs and never touches `TabAudioPipeline`/
  `PcmOutputPlayer` (asserted by test over the transport source).
- Logging: `LOG_COMPONENTS.LIVE_DUBBING` (`logConstants.js:41`) for all
  spike loggers; logs carry scalar codes only.

## 5. Files

| File | Role |
| --- | --- |
| `src/features/live-dubbing/spikes/openai/OpenAIRealtimeBootstrapService.js` | Background-only minter; secret-only bootstrap |
| `src/features/live-dubbing/spikes/openai/OpenAIRealtimeBootstrapService.test.js` | Mint contract tests (13) |
| `src/features/live-dubbing/spikes/openai/OpenAIRealtimeTranslationTransport.js` | Browser-neutral WebRTC transport |
| `src/features/live-dubbing/spikes/openai/OpenAIRealtimeTranslationTransport.test.js` | Transport tests (18) |
| `src/features/live-dubbing/spikes/openai/manualSpike.js` | Dev-only manual runner + console hook |
| `src/features/live-dubbing/spikes/openai/manualSpike.test.js` | Hook wiring tests (4) |

## 6. Bootstrap design

`mintClientSecret(targetLanguage)` validates the language tag
(`normalizeSpikeTargetLanguage`: trimmed, `^[A-Za-z]{2,8}(-…)*$`, ≤32
chars — binding only, no catalog), reads the first eligible key, POSTs the
verbatim mint body, and returns
`{ secret, targetLanguage, model, expiresAt }` or `null`. Every failure
(no keys, bad language, transport throw, non-ok, unreadable/malformed
payload, missing `value`) resolves to `null` and performs no further key
attempts. The returned object has exactly four keys — no API key, no
session object, no SDP.

## 7. Transport design

`start({ sourceStream|sourceAudioTrack, targetLanguage, bootstrap })`:

1. Reject a second start while a session is active or one is pending
   (`ALREADY_STARTED`, zero mutation — generation untouched).
2. Validate language, `bootstrap.secret`, and language binding
   (`bootstrap.targetLanguage` must equal the request when present).
3. Reserve the pending start synchronously (generation moves here, once per
   legitimate start), then resolve live audio tracks; fail `NO_AUDIO_TRACK`
   before creating any connection.
4. Create `RTCPeerConnection` (injected factory), create the `oai-events`
   data channel, wire transcript-only counting and `ontrack` → audio-element
   playback (`srcObject` + `play()`, best effort).
5. `addTrack` each source track, `createOffer` → `setLocalDescription`,
   POST `offer.sdp` as raw SDP, apply the raw-text answer via
   `setRemoteDescription({ type: 'answer', sdp })`.
6. The secret lives in one local during the POST and is never stored on the
   instance; telemetry/snapshots are scalar-only.

`dispose()` is idempotent and generation-fenced: it nulls channel/connection
handlers first, then closes channel, connection, and audio element, drops
track references, and records the `cleanup` milestone. `dispose()` during a
pending start invalidates the reservation, so a late factory resolution
cannot publish and its connection is closed (`START_CANCELLED`). Source
tracks are
never stopped — the transport owns none. Late `ontrack`/`onmessage` events
from a superseded generation are ignored. Setup failures run the same
close path (`_abandon`) so a failed start leaks no connection.

## 8. Manual / dev invocation path

Auth boundary: minting stays in the Background dev context (the only place
the long-lived key may be read); the Offscreen hook accepts an
already-minted ephemeral bootstrap and can never mint. `manualSpike.js`
imports neither the Background-only minter nor the key manager and never
reads the long-lived key setting (asserted by test).

Dev-only hook of choice: `installOpenAISpikeDevHook()` installs
`globalThis.__translateItOpenAIRealtimeSpike` (`{ start, stop, status }`).
`start({ sourceStream, targetLanguage, bootstrap })` forwards the caller
supplied bootstrap to the transport, which revalidates secret presence and
language binding. Never imported by production code.

Precise manual steps (requires a real `OPENAI_API_KEY` with Realtime access):

1. Background dev context (service-worker devtools): import
   `OpenAIRealtimeBootstrapService`, run
   `await new OpenAIRealtimeBootstrapService().mintClientSecret('es')`,
   and copy the returned ephemeral `{ secret, targetLanguage, model }`.
   The long-lived key never leaves this context.
2. Offscreen dev context: obtain a live `MediaStream` via the existing
   capture path (start normal live dubbing to MEDIA_ACQUIRED, or
   `getMediaStreamId` + `getUserMedia` in the offscreen console per
   coordinator lines 451–526). Open a tab playing continuous speech first.
3. Offscreen dev context: `hook = globalThis.__translateItOpenAIRealtimeSpike`
   (`installOpenAISpikeDevHook()` if absent).
4. Offscreen dev context:
   `await hook.start({ sourceStream, targetLanguage: 'es', bootstrap })`
   — expect `{ success: true }`.
5. Listen to the spike audio element; run `hook.status()` for scalar
   telemetry; `await hook.stop()` to end. The ephemeral secret is valid
   ~10 minutes (`expires_after` 600s); re-mint in the Background context
   for another run.

What to observe before any production decision:

- **Latency**: mouth-to-translated-audio delay vs Gemini path.
- **Correctness**: language match, no source-language bleed-through.
- **Continuity**: no gaps/dropouts over ≥5 minutes of continuous speech.
- **Overlap**: source audio audibility under translated audio.
- **Stability**: `transcriptEvents`/`remoteTracks` growth, no silent stalls,
  no unhandled data-channel errors.
- **Second-start**: `stop()` then `start()` on the same page works with no
  stale audio, no leaked peer connection, and fresh counters.

## 9. Test matrix (spec §12 coverage, all mocked/deterministic)

Bootstrap: verbatim endpoint/method/headers/body; secret-only bootstrap
shape; language/model binding; scalar `expiresAt` incl. omit/corrupt;
single-key reuse with no rotation; null-without-network on no-keys and bad
language; transport-throw, non-ok, and malformed-payload nulls; no
key/secret leakage in logs; proxy path + no direct fetch on config failure;
no secret persistence (source assertion).

Transport: track add + offer/answer round-trip; lone-track input; no-track
rejection without network; invalid-language and secret-less rejection
without network; language-mismatch fail-closed; `oai-events` creation; raw
SDP POST with secret Bearer + SDP content type; `ontrack` → element
playback; transcript-only counting with text/secret/SDP absence; scalar
telemetry/snapshot; idempotent dispose with handler clearing and no source
`stop()`; late-event fencing; SDP-failure connection close; empty-answer
rejection; second-start rejection with zero mutation (live session keeps
processing transcript/track events); proxy SDP path; browser-neutral source
assertion.

Hook: caller-minted bootstrap forwarding (+ language defaulting);
secret-less rejection without touching the transport; status/stop; hook
installation; offscreen key/mint-dependency absence (source assertion).

## 10. Validation (this spike)

- `vitest … src/features/live-dubbing/spikes/openai/`: 38 passed, 0 failed.
- Affected suites: `src/shared/runtime/OffscreenRuntimeLeaseManager.test.js`
  and the `src/features/live-dubbing/` suite must be re-run on the submit
  machine (see §12).
- Targeted ESLint on spike + lease files; `git diff --check`. No Chrome
  build (no bundling change — spike is plain modules under `src/`).
- No live call was made: no key exists in this environment, so the verdict
  below is by construction, not observation.

## 11. Risks / open questions for a live run

- Exact `output.language` tag format OpenAI expects (BCP-47 vs ISO-639-1).
- `noise_reduction: null` vs omitted field server behavior.
- Data-channel event taxonomy (which `type` values carry transcripts).
- Offscreen-document WebRTC + autoplay policy for the playback element.
- Whether one peer connection per language switch is required.

## 12. Verdict

**SPIKE_DEFERRED** — implementation and mocked contract tests are complete
and isolated, but no real translation audio was observed (no live key in
this environment), so feasibility is undecided. To promote: run §8 manually,
record the six observations, then decide between a production adapter
behind the provider registry or deletion of the spike tree.
