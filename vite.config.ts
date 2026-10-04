import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const p = (target: string, prefix: string) => ({
  target,
  changeOrigin: true,
  rewrite: (s: string) => s.replace(new RegExp(`^${prefix}`), ''),
});

const proxyRules = {
  '/llm/ollama':   p('http://localhost:11434', '/llm/ollama'),
  '/llm/lmstudio': p('http://localhost:1234', '/llm/lmstudio'),
  '/api/openalex': p('https://api.openalex.org', '/api/openalex'),
  '/api/arxiv':    p('https://export.arxiv.org', '/api/arxiv'),
  '/api/hal':      p('https://api.archives-ouvertes.fr', '/api/hal'),
  '/api/unpaywall':p('https://api.unpaywall.org', '/api/unpaywall'),
  '/api/crossref': p('https://api.crossref.org', '/api/crossref'),
  '/api/openlibrary': p('https://openlibrary.org', '/api/openlibrary'),
};

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: proxyRules,
  },
  preview: {
    proxy: proxyRules,
  },
});
