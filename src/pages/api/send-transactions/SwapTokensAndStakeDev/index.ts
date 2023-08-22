/* eslint-disable functional/no-conditional-statements */
import type { APIRoute } from 'astro'
import abi from './abi'
import { json } from 'utils/json'
import { agentAddresses } from '@devprotocol/dev-kit/agent'
import { createWallet } from 'utils/wallet'
import { Contract } from 'ethers'
import { auth } from 'utils/auth'

export const post: APIRoute = async ({ request }) => {
	if (!auth(request)) {
		return { body: json({ message: 'authentication faild' }) }
	}

	const { rpcUrl, chainId, args } =
		((await request.json()) as {
			rpcUrl?: string
			chainId?: number
			args?: {
				to: string
				property: string
				payload: string
				gatewayAddress: string
				amounts: {
					token: string
					input: string
					fee: string
				}
			}
		}) ?? {}

	if (!rpcUrl) {
		return { body: json({ message: 'missing parameter: rpcUrl' }) }
	}

	if (!chainId) {
		return { body: json({ message: 'missing parameter: chainId' }) }
	}

	if (!args) {
		return { body: json({ message: 'missing parameter: args' }) }
	}

	const address =
		chainId === 137
			? agentAddresses.polygon.mainnet.swapArbitraryTokens.swap
			: chainId === 80001
			? agentAddresses.polygon.mumbai.swapArbitraryTokens.swap
			: undefined

	if (!address) {
		return { body: json({ message: `unexpected chainId: ${chainId}` }) }
	}

	const wallet = createWallet({ rpcUrl })

	if (!wallet) {
		return { body: json({ message: 'wallet error' }) }
	}

	const contract = new Contract(address, abi, wallet)

	const tx = await contract
		.mintFor(
			args.to,
			args.property,
			args.payload,
			args.gatewayAddress,
			args.amounts,
		)
		.catch((err: Error) => err)

	if (tx instanceof Error) {
		return {
			body: json({
				message: 'faild to send the transaction',
				error: tx.message,
			}),
		}
	}

	return { body: json({ message: 'success' }) }
}
