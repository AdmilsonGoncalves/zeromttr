import tailwindcss from '@tailwindcss/vite';
import * as fs from 'node:fs';
import * as path from 'node:path';

function angularTemplateInlinePlugin() {
  return {
    name: 'angular-template-inline',
    transform(this: { addWatchFile?: (id: string) => void }, code: string, id: string) {
      if (!id.endsWith('.component.ts')) {
        return null;
      }

      const dir = path.dirname(id);
      let transformed = code;

      // Inline templateUrl
      transformed = transformed.replace(
        /templateUrl\s*:\s*['"](\.[^'"]+)['"]/g,
        (match, relativePath) => {
          const filePath = path.resolve(dir, relativePath);
          if (fs.existsSync(filePath)) {
            if (typeof this.addWatchFile === 'function') {
              this.addWatchFile(filePath);
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            return `template: ${JSON.stringify(content)}`;
          }
          return match;
        }
      );

      // Inline styleUrl
      transformed = transformed.replace(
        /styleUrl\s*:\s*['"](\.[^'"]+)['"]/g,
        (match, relativePath) => {
          const filePath = path.resolve(dir, relativePath);
          if (fs.existsSync(filePath)) {
            if (typeof this.addWatchFile === 'function') {
              this.addWatchFile(filePath);
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            return `styles: [${JSON.stringify(content)}]`;
          }
          return match;
        }
      );

      return {
        code: transformed,
        map: null
      };
    }
  };
}

export default {
  root: '.',
  plugins: [tailwindcss(), angularTemplateInlinePlugin()],
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false
      }
    }
  },
  server: {
    port: 4200,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.MOCK_SERVER_PORT || process.env.PORT || 8080}`,
        changeOrigin: true
      }
    }
  }
};
