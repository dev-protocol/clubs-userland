import type { APIRoute } from 'astro'
import abi from './abi'
import { json, headers } from 'utils/json'
import { agentAddresses } from '@devprotocol/dev-kit/agent'
import { createWallet } from 'utils/wallet'
import { Contract, JsonRpcProvider, TransactionResponse } from 'ethers'
import { auth } from 'utils/auth'
import {
	whenDefinedAll,
	whenNotErrorAll,
	whenNotError,
} from '@devprotocol/util-ts'
import { always } from 'ramda'

export const POST: APIRoute = async ({ request }) => {
	const authres = auth(request) ? true : new Error('authentication faild')

	const {
		rpcUrl: rpcUrl_,
		chainId: chainId_,
		args: args_,
	} = ((await request.json()) as {
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

	const props = whenNotError(
		authres,
		always(
			whenDefinedAll([rpcUrl_, chainId_, args_], ([rpcUrl, chainId, args]) => ({
				rpcUrl,
				chainId,
				args,
			})) ?? new Error('missing required parameter'),
		),
	)

	const address = whenNotError(props, ({ chainId }) =>
		chainId === 137
			? agentAddresses.polygon.mainnet.swapArbitraryTokens.swap
			: chainId === 80001
			? agentAddresses.polygon.mumbai.swapArbitraryTokens.swap
			: new Error(`unexpected chainId: ${chainId}`),
	)

	const wallet = whenNotError(
		props,
		({ rpcUrl }) => createWallet({ rpcUrl }) ?? new Error('wallet error'),
	)

	const contract = whenNotErrorAll(
		[address, wallet],
		([addr, wal]) => new Contract(addr, abi, wal),
	)

	const feeData = await whenNotError(props, async ({ rpcUrl }) => {
		const fromChain = await new JsonRpcProvider(rpcUrl)
			.getFeeData()
			.catch((err: Error) => err)
		const multiplied = whenNotError(
			fromChain,
			(_data) =>
				whenDefinedAll(
					[_data.maxFeePerGas, _data.maxPriorityFeePerGas],
					([maxFeePerGas, maxPriorityFeePerGas]) => ({
						maxFeePerGas: (maxFeePerGas * 12n) / 10n,
						maxPriorityFeePerGas: (maxPriorityFeePerGas * 12n) / 10n,
					}),
				) ?? new Error('Missing fee data: maxFeePerGas, maxPriorityFeePerGas'),
		)
		return multiplied
	})

	const tx = await whenNotErrorAll(
		[contract, props, feeData],
		([cont, { args }, { maxFeePerGas, maxPriorityFeePerGas }]) =>
			cont
				.mintFor(
					args.to,
					args.property,
					args.payload,
					args.gatewayAddress,
					args.amounts,
					{ maxFeePerGas, maxPriorityFeePerGas },
				)
				.then((res: TransactionResponse) => res)
				.catch((err: Error) => err),
	)

	console.log({ tx })

	return tx instanceof Error
		? new Response(json({ message: 'error', error: tx.message }), {
				status: 400,
				headers,
		  })
		: new Response(json({ message: 'success' }), { status: 200, headers })
}
