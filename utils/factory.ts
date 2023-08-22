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

export const factory =
	(app: App) => async (request: VercelRequest, response: VercelResponse) => {
		const body = (request.body as null | JSON) ?? ({} as JSON)
		const res = await app({ body })

		response.json(res.body)
	}
