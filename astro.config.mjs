import { config } from 'dotenv'
import { defineConfig } from 'astro/config'
import vercel from '@astrojs/vercel/serverless'

config()

export default defineConfig({
	server: {
		port: 3000,
	},
	output: 'server',
	adapter: vercel(),
})
