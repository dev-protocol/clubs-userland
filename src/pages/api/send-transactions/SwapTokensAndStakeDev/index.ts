import type { APIRoute } from 'astro'
import abi from './abi'
import { json, headers } from 'utils/json'
import { agentAddresses } from '@devprotocol/dev-kit/agent'
import { createWallet } from 'utils/wallet'
import {
	Contract,
	JsonRpcProvider,
	NonceManager,
	TransactionResponse,
} from 'ethers'
import { auth } from 'utils/auth'
import {
	whenDefinedAll,
	whenNotErrorAll,
	whenNotError,
} from '@devprotocol/util-ts'
import { always, tryCatch } from 'ramda'
import fetch from 'cross-fetch'
import BigNumber from 'bignumber.js'

type GasStaionReturnValue = Readonly<{
	safeLow: Readonly<{
		maxPriorityFee: number
		maxFee: number
	}>
	standard: Readonly<{
		maxPriorityFee: number
		maxFee: number
	}>
	fast: Readonly<{
		maxPriorityFee: number
		maxFee: number
	}>
	estimatedBaseFee: number
	blockTime: number
	blockNumber: number
}>

const WeiPerGwei = '1000000000'

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

	const feeDataFromGS = await whenNotError(props, async ({ chainId }) => {
		const url =
			chainId === 137
				? 'https://gasstation.polygon.technology/v2'
				: chainId === 80001
				? 'https://gasstation-testnet.polygon.technology/v2'
				: new Error('Cannot found gas stasion URL')
		const gsRes = await whenNotError(url, (endpoint) =>
			fetch(endpoint).catch((err: Error) => err),
		)
		const result = await whenNotError(gsRes, (res) =>
			res
				.json()
				.then((x) => x as GasStaionReturnValue)
				.catch((err: Error) => err),
		)
		const multiplied = whenNotError(
			result,
			(_data) =>
				whenDefinedAll(
					[_data.fast.maxFee, _data.fast.maxPriorityFee],
					([maxFeePerGas, maxPriorityFeePerGas]) => ({
						maxFeePerGas: new BigNumber(maxFeePerGas)
							.times(WeiPerGwei)
							.times(1.2)
							.dp(0)
							.toFixed(),
						maxPriorityFeePerGas: new BigNumber(maxPriorityFeePerGas)
							.times(WeiPerGwei)
							.times(1.2)
							.dp(0)
							.toFixed(),
					}),
				) ?? new Error('Missing fee data: fast.maxFee, fast.maxPriorityFee'),
		)
		return multiplied
	})

	const feeData =
		feeDataFromGS instanceof Error
			? await whenNotError(props, async ({ rpcUrl }) => {
					const fromChain = await new JsonRpcProvider(rpcUrl)
						.getFeeData()
						.catch((err: Error) => err)
					const multiplied = whenNotError(
						fromChain,
						(_data) =>
							whenDefinedAll(
								[_data.maxFeePerGas, _data.maxPriorityFeePerGas],
								([maxFeePerGas, maxPriorityFeePerGas]) => ({
									maxFeePerGas: new BigNumber(maxFeePerGas.toString())
										.times(1.2)
										.dp(0)
										.toFixed(),
									maxPriorityFeePerGas: new BigNumber(
										maxPriorityFeePerGas.toString(),
									)
										.times(1.2)
										.dp(0)
										.toFixed(),
								}),
							) ??
							new Error('Missing fee data: maxFeePerGas, maxPriorityFeePerGas'),
					)
					return multiplied
			  })
			: feeDataFromGS

	const nonce = await whenNotError(wallet, async (wal) => {
		const valid = tryCatch(
			(_wal) => {
				const nonceManager = new NonceManager(_wal)
				return nonceManager.reset()
			},
			(err: Error) => err,
		)(wal)
		return whenNotError(valid, always(wal.getNonce()))
	})

	const gasLimit = await whenNotErrorAll(
		[contract, props],
		([cont, { args }]) =>
			cont.mintFor
				.estimateGas(
					args.to,
					args.property,
					args.payload,
					args.gatewayAddress,
					args.amounts,
				)
				.then((res) => res)
				.catch((err: Error) => err),
	)

	const tx = await whenNotErrorAll(
		[contract, props, nonce, gasLimit, feeData],
		([
			cont,
			{ args },
			_nonce,
			_gasLimit,
			{ maxFeePerGas, maxPriorityFeePerGas },
		]) =>
			cont
				.mintFor(
					args.to,
					args.property,
					args.payload,
					args.gatewayAddress,
					args.amounts,
					{
						nonce: _nonce,
						gasLimit: _gasLimit,
						maxFeePerGas,
						maxPriorityFeePerGas,
					},
				)
				.then((res: TransactionResponse) => res)
				.catch((err: Error) => err),
	)

	console.log({ tx, feeDataFromGS, feeData })

	return tx instanceof Error
		? new Response(json({ message: 'error', error: tx.message }), {
				status: 400,
				headers,
		  })
		: new Response(json({ message: 'success' }), { status: 200, headers })
}
