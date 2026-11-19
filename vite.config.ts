import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const base = process.env.VITE_BASE_PATH || '/gradtrip/';
function preloadInitialSquad(): Plugin {
  return {
    name: 'preload-initial-squad', apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, { bundle }) {
        if (!bundle) return;
        const image = () => {
          const asset = Object.values(bundle).find(item => item.type === 'asset' && item.names.includes('travel-kit.webp'));
          if (!asset) throw new Error('Missing travel-kit image');
          return base + asset.fileName;
        };
        const script = `(()=>{const route=location.hash.split('?')[0];if(route&&route!=='#/'&&!/^#\\/trip\\/[^/]+\\/squad$/.test(route))return;const link=document.createElement('link');Object.assign(link,{rel:'preload',as:'image',fetchPriority:'high',media:'(min-width: 1000px)',href:${JSON.stringify(image())}});document.head.append(link)})();`;
        // Run after viewport metadata and before stylesheets can block this script.
        if (!html.includes('</title>')) throw new Error('Missing document title');
        return { html: html.replace('</title>', `</title><script>${script}</script>`), tags: [] };
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadInitialSquad()],
  base,
  build: { manifest: true },
});
