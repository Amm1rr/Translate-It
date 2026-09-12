import { describe, expect, it, vi } from 'vitest';
import { createOpenAIManualSpikeRunner, installOpenAISpikeDevHook } from './manualSpike.js';

const BOOTSTRAP = { secret: 'ek_test_secret', targetLanguage: 'es', model: 'gpt-realtime-translate' };

function createRunner({ startResult = { success: true, targetLanguage: 'es' } } = {}) {
  const start = vi.fn(async () => startResult);
  const dispose = vi.fn(async () => ({ success: true }));
  const getSnapshot = vi.fn(() => ({ active: true, targetLanguage: 'es', telemetry: {} }));
  return {
    calls: { start, dispose, getSnapshot },
    runner: createOpenAIManualSpikeRunner({
      transport: { start, dispose, getSnapshot },
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    }),
  };
}

describe('OpenAI manual spike hook (SPIKE)', () => {
  it('forwards the caller-minted bootstrap to the transport', async () => {
    const { runner, calls } = createRunner();
    const sourceAudioTrack = { kind: 'audio', readyState: 'live' };

    await expect(runner.start({ sourceAudioTrack, targetLanguage: 'es', bootstrap: BOOTSTRAP }))
      .resolves.toEqual({ success: true, targetLanguage: 'es' });

    expect(calls.start).toHaveBeenCalledWith({
      sourceStream: undefined,
      sourceAudioTrack,
      targetLanguage: 'es',
      bootstrap: BOOTSTRAP,
    });
  });

  it('defaults the target language to the bootstrap binding when omitted', async () => {
    const { runner, calls } = createRunner();

    await expect(runner.start({ bootstrap: BOOTSTRAP })).resolves.toEqual({
      success: true,
      targetLanguage: 'es',
    });
    expect(calls.start).toHaveBeenCalledWith({
      sourceStream: undefined,
      sourceAudioTrack: undefined,
      targetLanguage: 'es',
      bootstrap: BOOTSTRAP,
    });
  });

  it('rejects a missing or secret-less bootstrap without touching the transport', async () => {
    const { runner, calls } = createRunner();

    await expect(runner.start({ targetLanguage: 'es' })).resolves.toEqual({
      success: false,
      error: 'INVALID_BOOTSTRAP',
    });
    await expect(runner.start({ targetLanguage: 'es', bootstrap: { targetLanguage: 'es' } }))
      .resolves.toEqual({ success: false, error: 'INVALID_BOOTSTRAP' });
    expect(calls.start).not.toHaveBeenCalled();
  });

  it('exposes status and idempotent stop', async () => {
    const { runner, calls } = createRunner();

    expect(runner.status().success).toBe(true);
    await runner.stop();
    expect(calls.dispose).toHaveBeenCalledOnce();
  });

  it('installs a dev-console hook without production wiring', () => {
    const { calls } = createRunner();
    const installed = installOpenAISpikeDevHook({
      transport: { start: calls.start, dispose: calls.dispose, getSnapshot: calls.getSnapshot },
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    });

    expect(globalThis.__translateItOpenAIRealtimeSpike).toBe(installed);
    expect(typeof installed.start).toBe('function');
    expect(typeof installed.stop).toBe('function');
    expect(typeof installed.status).toBe('function');
    delete globalThis.__translateItOpenAIRealtimeSpike;
  });

  it('keeps the offscreen hook free of key and mint dependencies', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const offscreenSources = ['manualSpike.js', 'OpenAIRealtimeTranslationTransport.js', 'spikeTargetLanguage.js'];

    for (const file of offscreenSources) {
      const source = await readFile(join(
        process.cwd(),
        'src/features/live-dubbing/spikes/openai',
        file,
      ), 'utf8');
      for (const forbidden of ['ApiKeyManager', 'OpenAIRealtimeBootstrapService', 'OPENAI_API_KEY', 'mintClientSecret']) {
        expect(source).not.toContain(forbidden);
      }
    }

    const hookSource = await readFile(join(
      process.cwd(),
      'src/features/live-dubbing/spikes/openai/manualSpike.js',
    ), 'utf8');
    expect(hookSource).toContain('OpenAIRealtimeTranslationTransport');
  });
});
