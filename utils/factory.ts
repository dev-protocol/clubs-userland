import type { VercelRequest, VercelResponse } from '@vercel/node'

export type JSON = Readonly<
	Record<
		string,
		| string
		| boolean
		| number
		| undefined
		| null
		| Readonly<Record<string, string | boolean | number | undefined | null>>
	>
>

export type App = (req: { body: JSON }) => Promise<{ body: JSON }>

const { API_KEY } = process.env

export const factory =
	(app: App) => async (request: VercelRequest, response: VercelResponse) => {
		const key = request.headers.authorization?.replace(/Bearer(\s)+/i, '')
		if (key !== API_KEY) {
			response.json({ message: 'authorization failed' })
		}
		const body = (request.body as null | JSON) ?? ({} as JSON)
		const res = await app({ body })

		response.json(res.body)
	}
