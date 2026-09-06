import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import DeepseekApiSettings from './DeepseekApiSettings.vue';

const mocks = vi.hoisted(() => ({
  settingsStore: null,
  models: [
    { value: 'thinking-model', name: 'Thinking Model', supportsThinking: true },
    { value: 'standard-model', name: 'Standard Model', supportsThinking: false },
    { value: 'custom', name: 'Custom Model' },
  ],
  settingsModels: [
    { value: 'thinking-model', name: 'Thinking Model' },
    { value: 'standard-model', name: 'Standard Model', supportsThinking: true },
    { value: 'custom', name: 'Custom Model', supportsThinking: true },
  ],
}));

vi.mock('@/features/settings/stores/settings.js', () => ({
  useSettingsStore: vi.fn(() => mocks.settingsStore),
}));

vi.mock('@/shared/config/config.js', () => ({
  CONFIG: {
    DEEPSEEK_API_MODEL: 'thinking-model',
    DEEPSEEK_MODELS: mocks.models,
    DEEPSEEK_THINKING_MODE_OPTIONS: [],
  },
}));

vi.mock('@/composables/ui/useRTLSelect.js', () => ({
  useRTLSelect: vi.fn(() => ({ rtlSelectStyle: {} })),
}));

vi.mock('@/features/translation/providers/ApiKeyManager.js', () => ({
  ApiKeyManager: { testKeysDirect: vi.fn() },
}));

vi.mock('@/features/translation/providers/ProviderConstants.js', () => ({
  ProviderRegistryIds: { DEEPSEEK: 'deepseek' },
}));

vi.mock('@/features/settings/presentation/ProviderSettingsErrorPresenter.js', () => ({
  presentProviderSettingsError: vi.fn(() => ({})),
}));

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({ t: vi.fn((key) => key) })),
}));

vi.mock('./ApiKeyInput.vue', () => ({
  default: { template: '<div />' },
}));

vi.mock('@/components/base/BaseInput.vue', () => ({
  default: { template: '<div />' },
}));

vi.mock('@/components/base/BaseSelect.vue', () => ({
  default: {
    props: ['modelValue', 'options'],
    emits: ['update:modelValue'],
    template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>',
  },
}));

describe('DeepseekApiSettings thinking mode eligibility', () => {
  beforeEach(() => {
    mocks.settingsStore = {
      settings: reactive({
        DEEPSEEK_API_MODEL: 'thinking-model',
        DEEPSEEK_MODELS: mocks.settingsModels,
        DEEPSEEK_THINKING_MODE: 'high',
      }),
      updateSettingLocally: vi.fn(),
    };
  });

  it('shows thinking mode only for CONFIG model metadata with supportsThinking true', async () => {
    const wrapper = mount(DeepseekApiSettings);

    expect(wrapper.find('.thinking-mode-select').exists()).toBe(true);

    await wrapper.get('.model-select').setValue('standard-model');
    expect(wrapper.find('.thinking-mode-select').exists()).toBe(false);

    await wrapper.get('.model-select').setValue('custom');
    expect(wrapper.find('.thinking-mode-select').exists()).toBe(false);

    wrapper.unmount();
  });
});
