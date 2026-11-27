/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRIMEUI_LICENSE_KEY?: string;
  readonly VITE_DOCS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
