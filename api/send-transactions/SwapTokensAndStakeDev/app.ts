import { createWallet } from '../../../utils/wallet.js'
import type { App } from '../../../utils/factory.js'
import { Contract } from 'ethers'
import abi from './abi.js'
import { utils } from '@devprotocol/dev-kit'
import { agentAddresses } from '@devprotocol/dev-kit/agent'

export const app: App = async ({ body }) => {
	const { rpcUrl, chainId, args } =
		(body as {
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
		return { body: { message: 'missing parameter: rpcUrl' } }
	}

	if (!chainId) {
		return { body: { message: 'missing parameter: chainId' } }
	}

	if (!args) {
		return { body: { message: 'missing parameter: args' } }
	}

	const address =
		chainId === 137
			? agentAddresses.polygon.mainnet.swapArbitraryTokens.swap
			: chainId === 80001
			? agentAddresses.polygon.mumbai.swapArbitraryTokens.swap
			: undefined

	if (!address) {
		return { body: { message: `unexpected chainId: ${chainId}` } }
	}

	const wallet = createWallet({ rpcUrl })

	if (!wallet) {
		return { body: { message: 'wallet error' } }
	}

	const contract = new Contract(address, abi, wallet)

	const tx = await utils
		.execute({
			contract,
			method: 'mintFor',
			args: [
				args.to,
				args.property,
				args.payload,
				args.gatewayAddress,
				[args.amounts.token, args.amounts.input, args.amounts.fee],
			],
			mutation: true,
		})
		.catch((err: Error) => err)

	if (tx instanceof Error) {
		console.error({ tx })
		return {
			body: { message: 'faild to send the transaction', error: tx.message },
		}
	}

	return { body: { message: 'success' } }
}
