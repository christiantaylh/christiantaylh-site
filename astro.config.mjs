import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://christiantaylh.com',
  output: 'static',
  adapter: vercel(),
  vite: {
    plugins: [tailwindcss()],
  },
  image: {
    domains: ['img.youtube.com', 'i.ytimg.com'],
  },
});
