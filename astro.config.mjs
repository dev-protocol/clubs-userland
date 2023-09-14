import { config } from 'dotenv'
import { defineConfig } from 'astro/config'
import vercel from '@astrojs/vercel/serverless'

// eslint-disable-next-line functional/no-expression-statements
config()

export default defineConfig({
	output: 'server',
	adapter: vercel(),
})
