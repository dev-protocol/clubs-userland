import { config } from 'dotenv'
import { defineConfig } from 'astro/config'
import vercel from '@astrojs/vercel/serverless'

config()

export default defineConfig({
	output: 'server',
	adapter: vercel(),
	security: {
		checkOrigin: false,
	},
})
