import { beforeEach, describe, expect, it, vi } from 'vitest'

const registeredHandlers = new Map()
const registerHandlerMock = vi.fn((action, handler) => registeredHandlers.set(action, handler))
const translateTextHandler = vi.fn()
const settingsUpdatedHandler = vi.fn()

vi.mock('webextension-polyfill', () => ({ default: {} }))
vi.mock('@/core/background/feature-loader.js', () => ({ featureLoader: {} }))
vi.mock('@/features/translation/core/translation-engine.js', () => ({ TranslationEngine: vi.fn() }))
vi.mock('@/shared/messaging/core/MessageHandler.js', () => ({
  createMessageHandler: () => ({ registerHandler: registerHandlerMock, isListenerActive: false })
}))
vi.mock('@/core/background/handlers/index.js', async (importOriginal) => ({
  ...await importOriginal(),
  handleTranslateTextLazy: translateTextHandler,
  handleSettingsUpdatedLazy: settingsUpdatedHandler
}))
vi.mock('@/shared/logging/logger.js', () => ({
  getScopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))
vi.mock('@/core/browserHandlers.js', () => ({ addBrowserSpecificHandlers: vi.fn() }))
vi.mock('@/utils/UtilsFactory.js', () => ({ utilsFactory: {} }))

const { MessageActions } = await import('@/shared/messaging/core/MessageActions.js')
const { LifecycleManager } = await import('./LifecycleManager.js')

describe('LifecycleManager translation text routing', () => {
  beforeEach(() => {
    registeredHandlers.clear()
    registerHandlerMock.mockClear()
  })

  it('routes enum and legacy actions through the same handler without duplicate registration', () => {
    const manager = new LifecycleManager()
    manager.registerMessageHandlers()

    expect(registeredHandlers.get(MessageActions.TRANSLATE_TEXT)).toBe(translateTextHandler)
    expect(registeredHandlers.get('translateText')).toBe(translateTextHandler)
    expect(registeredHandlers.get(MessageActions.SETTINGS_UPDATED)).toBe(settingsUpdatedHandler)
    expect(registeredHandlers.get(MessageActions.IFRAME_SELECT_ELEMENT_FINISHED)).toEqual(expect.any(Function))
    expect(registeredHandlers.get(MessageActions.SELECT_ELEMENT_FRAME_READY)).toEqual(expect.any(Function))
    expect(registeredHandlers.has(MessageActions.TRANSLATION_RESULT_UPDATE)).toBe(false)
    expect(registeredHandlers.has('providerStatus')).toBe(false)
    expect(registerHandlerMock.mock.calls.filter(([action]) => action === MessageActions.TRANSLATE_TEXT)).toHaveLength(1)
    expect(registerHandlerMock.mock.calls.filter(([action]) => action === 'translateText')).toHaveLength(1)
    expect(registerHandlerMock.mock.calls.filter(([action]) => action === MessageActions.SELECT_ELEMENT_FRAME_READY)).toHaveLength(1)
  })

  it('keeps refresh action registered without an undefined action mapping', () => {
    const manager = new LifecycleManager()
    manager.registerMessageHandlers()

    expect(registeredHandlers.get(MessageActions.REFRESH_CONTEXT_MENUS)).toEqual(expect.any(Function))
    expect(registeredHandlers.has('undefined')).toBe(false)
  })
})

describe('LifecycleManager legacy Select Element handler removal', () => {
  const LAZY_SELECT_ELEMENT_HANDLERS = [
    'handleActivateSelectElementModeLazy',
    'handleDeactivateSelectElementModeLazy',
    'handleSetSelectElementStateLazy',
    'handleGetSelectElementStateLazy',
    'handleIframeSelectElementFinishedLazy',
    'handleSelectElementFrameReadyLazy'
  ]

  beforeEach(() => {
    registeredHandlers.clear()
    registerHandlerMock.mockClear()
  })

  it('no longer exports the legacy handleSelectElement while keeping lazy routing', async () => {
    const Handlers = await import('@/core/background/handlers/index.js')

    expect('handleSelectElement' in Handlers).toBe(false)
    for (const name of LAZY_SELECT_ELEMENT_HANDLERS) {
      expect(Handlers[name]).toEqual(expect.any(Function))
    }
  })

  it('registration leaves no unmapped legacy handleSelectElement warning source', async () => {
    const Handlers = await import('@/core/background/handlers/index.js')
    const manager = new LifecycleManager()
    manager.registerMessageHandlers()

    const mappedHandlers = new Set(registerHandlerMock.mock.calls.map(([, handler]) => handler))
    const unmappedNames = Object.entries(Handlers)
      .filter(([, value]) => typeof value === 'function' && !mappedHandlers.has(value))
      .map(([name]) => name)

    expect(unmappedNames).not.toContain('handleSelectElement')
    for (const name of LAZY_SELECT_ELEMENT_HANDLERS) {
      expect(mappedHandlers.has(Handlers[name])).toBe(true)
    }
  })
})

describe('LifecycleManager context menu refresh failures', () => {
  it('propagates context menu refresh failure after emergency fallback', async () => {
    const manager = new LifecycleManager()
    const error = new Error('context menu setup failed')
    manager.featureLoader = {
      loadContextMenuManager: vi.fn().mockRejectedValue(error)
    }
    manager.createContextMenuDirectly = vi.fn().mockResolvedValue(undefined)

    await expect(manager.refreshContextMenus()).rejects.toBe(error)
    expect(manager.createContextMenuDirectly).toHaveBeenCalledOnce()
  })
})
