import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      ENABLE_DEMO_MODE: 'true',
      CHAOS_ENDPOINTS_ENABLED: ''
    }
  }
});
