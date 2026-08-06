import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const DESCRIPTION =
  '영화·드라마·애니를 본 기록이 별이 되어 남는 3D 우주 아카이브. 장르는 은하가 되고, 잇고 싶은 작품은 별자리가 됩니다.';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'og.png'],
      manifest: {
        name: 'Asteron — 내가 본 이야기들이 별이 되어 남는 곳',
        short_name: 'Asteron',
        description: DESCRIPTION,
        lang: 'ko',
        dir: 'ltr',
        theme_color: '#000104',
        background_color: '#04070f',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['entertainment', 'lifestyle'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The 3D bundle is large; precache the app shell so it opens offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // …but not the 92 unicode-range chunks of the Korean typeface. Their
        // whole point is that a page fetches only the syllables it renders;
        // precaching them all would put 2.2MB into every install to hold
        // glyphs most users never see. They are runtime-cached below instead,
        // and font-display: swap covers the first paint.
        globIgnores: ['**/fonts/wanted-sans/woff2/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // The typeface chunks are same-origin and immutable, so they are
            // kept for a year once a syllable has actually been rendered. The
            // cap sits above the 92 chunks the family ships, because too low a
            // cap silently evicts chunks and drops text to a fallback face.
            urlPattern: /\/fonts\/wanted-sans\/.*\.woff2$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'font-files',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // TMDB posters: revisited works keep their poster offline.
            urlPattern: /^https:\/\/image\.tmdb\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tmdb-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
