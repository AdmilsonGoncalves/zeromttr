import { defineConfig } from 'vitest/config';
import { angularTemplateInlinePlugin } from './vite.config.js';

export default defineConfig({
  plugins: [angularTemplateInlinePlugin()],
  test: {
    globals: true,
    environment: 'node'
  }
});
