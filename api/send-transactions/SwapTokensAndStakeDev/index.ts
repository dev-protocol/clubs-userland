import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createWallet } from '../../../utils/wallet'

export default function (request: VercelRequest, response: VercelResponse) {
	const { rpcUrl } = (request.body as null | { rpcUrl?: string }) ?? {}

	if (!rpcUrl) {
		return response.json({ message: 'missing parameter: rpcUrl' })
	}

	const wallet = createWallet({ rpcUrl })

	console.log({ wallet })

	const { name = 'World' } = request.query
	response.send(`Hello ${name}!`)
}
