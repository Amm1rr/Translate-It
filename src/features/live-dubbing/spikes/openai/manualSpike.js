import { getScopedLogger } from '@/shared/logging/logger.js';
import { LOG_COMPONENTS } from '@/shared/logging/logConstants.js';
import { OpenAIRealtimeTranslationTransport } from './OpenAIRealtimeTranslationTransport.js';

const logger = getScopedLogger(LOG_COMPONENTS.LIVE_DUBBING, 'OpenAIManualSpike(SPIKE)');

/**
 * Dev-only manual runner for the Phase D OpenAI Realtime WebRTC spike.
 *
 * Auth boundary: this module runs on the Offscreen side and never mints.
 * It never imports the Background-only minter or the key manager and never
 * reads the long-lived key setting. The caller mints in a Background dev
 * context and passes the already-minted ephemeral bootstrap here:
 * `start({ sourceStream, targetLanguage, bootstrap })`.
 *
 * Capture reuse is by reference only: the caller hands an already-captured
 * `MediaStream` (or lone audio track) to `start()` — e.g. the tab stream
 * produced by the existing `LiveDubbingCoordinator` capture stages
 * (lease acquire → PREPARE → `getMediaStreamId` → CONSUME → MEDIA_ACQUIRED;
 * see `LiveDubbingCoordinator._startTransaction`, ~lines 451–526). This
 * module never imports `chrome.tabCapture` and never touches
 * `TabAudioPipeline`/`PcmOutputPlayer`; the transport input stays
 * browser-neutral (`{ sourceStream|sourceAudioTrack, targetLanguage,
 * bootstrap }`).
 *
 * Never imported by production code. See
 * `docs/technical/spikes/OPENAI_LIVE_DUBBING_WEBRTC_SPIKE.md` for the
 * manual procedure and observations.
 */
export function createOpenAIManualSpikeRunner(options = {}) {
  const transport = options.transport || new OpenAIRealtimeTranslationTransport({
    peerConnectionFactory: options.peerConnectionFactory,
    fetchImpl: options.fetchImpl,
    audioElementFactory: options.audioElementFactory,
    performanceNow: options.performanceNow,
    logger: options.logger,
  });
  const log = options.logger || logger;

  return {
    /**
     * Start one WebRTC translation session from an already-minted ephemeral
     * bootstrap. Minting stays in the Background dev context; this hook only
     * forwards the bootstrap to the transport, which revalidates it.
     * @param {{sourceStream?: object, sourceAudioTrack?: object, targetLanguage?: unknown, bootstrap: {secret?: unknown, targetLanguage?: unknown}}} input
     */
    async start(input = {}) {
      const bootstrap = input.bootstrap && typeof input.bootstrap === 'object'
        ? input.bootstrap
        : null;
      if (!bootstrap || typeof bootstrap.secret !== 'string' || !bootstrap.secret) {
        log.debug('[OpenAIManualSpike] start requires an already-minted bootstrap');
        return { success: false, error: 'INVALID_BOOTSTRAP' };
      }
      return transport.start({
        sourceStream: input.sourceStream,
        sourceAudioTrack: input.sourceAudioTrack,
        targetLanguage: input.targetLanguage ?? bootstrap.targetLanguage,
        bootstrap,
      });
    },

    /** Scalar-only spike status. No secret, SDP, or transcript text. */
    status() {
      return { success: true, ...transport.getSnapshot() };
    },

    /** Idempotent fenced teardown of the spike session. */
    async stop() {
      return transport.dispose();
    },
  };
}

/**
 * Install a dev-console hook (`globalThis.__translateItOpenAIRealtimeSpike`)
 * with `{ start, stop, status }`. Dev-only: never call from production code.
 * @returns {{start: Function, stop: Function, status: Function}}
 */
export function installOpenAISpikeDevHook(options = {}) {
  const runner = createOpenAIManualSpikeRunner(options);
  try {
    globalThis.__translateItOpenAIRealtimeSpike = runner;
  } catch { /* hook installation is best effort */ }
  return runner;
}
