import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'Dish Decoder',
        short_name: 'DishDecoder',
        description: 'powered Visual Menu Translator',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'huruhonnya-pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'huruhonnya-pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract\.js@.*/i,
            handler: 'CacheFirst', // 快取優先設定
            options: {
              cacheName: 'tesseract-cache', // 存放名稱
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 存放一年
              },
              cacheableResponse: {
                statuses: [0, 200] // 針對 CDN 的特殊設定
              }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': '/src'
    }
  }
})