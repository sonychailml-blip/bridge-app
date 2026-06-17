import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon-180.png'],
      manifest: {
        name: 'H',
        short_name: 'H',
        description: 'Find people through meaning, not photographs',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',   // только офлайн-фолбэк (навигации идут network-first)
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        runtimeCaching: [
          {
            // Документ (навигации) — всегда из сети: HTML обязан соответствовать
            // актуальным задеплоенным CSS/JS. Кэш — только офлайн-фолбэк.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 10 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // НЕ добавляем runtimeCaching для googleapis.com / cloudfunctions.net —
        // запросы Firebase (Firestore/Functions/Auth) идут напрямую в сеть, SW их не трогает.
      },
    }),
  ],
})
