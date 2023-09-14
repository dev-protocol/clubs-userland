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
import fetch from 'cross-fetch'
import BigNumber from 'bignumber.js'
import { createClient } from 'redis'
import { generateTransactionKey } from 'utils/db'

const { REDIS_URL, REDIS_USERNAME, REDIS_PASSWORD } = import.meta.env

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

	const redis = await whenNotError(
		createClient({
			url: REDIS_URL,
			username: REDIS_USERNAME ?? '',
			password: REDIS_PASSWORD ?? '',
		}),
		(db) =>
			db
				.connect()
				.then(always(db))
				.catch((err) => new Error(err)),
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

	const unsignedTx = await whenNotErrorAll(
		[contract, props, gasLimit, feeData],
		([cont, { args }, _gasLimit, { maxFeePerGas, maxPriorityFeePerGas }]) =>
			cont.mintFor
				.populateTransaction(
					args.to,
					args.property,
					args.payload,
					args.gatewayAddress,
					args.amounts,
					{
						gasLimit: _gasLimit,
						maxFeePerGas,
						maxPriorityFeePerGas,
					},
				)
				.then((res) => res)
				.catch((err: Error) => err),
	)

	const prevTransaction = await whenNotErrorAll(
		[unsignedTx, redis],
		([_tx, db]) =>
			whenDefinedAll([_tx.to, _tx.data], ([to, data]) =>
				db.get(generateTransactionKey(to, data)),
			) ??
			new Error(
				'Missing TransactionRequest field to get the prev transaction: .to, .data',
			),
	)

	const validExecutionInterval = whenNotError(prevTransaction, (ptx) => {
		const lasttime = typeof ptx === 'string' ? Number(ptx) : undefined
		const now = new Date().getTime()
		const oneMin = 60000
		const interval = now - (lasttime ?? 0)
		return interval > oneMin
			? true
			: new Error(`Invalid execution interval: ${interval}ms`)
	})

	const tx = await whenNotErrorAll(
		[wallet, unsignedTx, validExecutionInterval],
		([wal, _tx]) =>
			wal
				.sendTransaction(_tx)
				.then((res: TransactionResponse) => res)
				.catch((err: Error) => err),
	)

	const saved = await whenNotErrorAll(
		[tx, redis],
		([_tx, db]) =>
			whenDefinedAll([_tx.to, _tx.data], ([to, data]) =>
				db.set(generateTransactionKey(to, data), new Date().getTime()),
			) ??
			new Error(
				'Missing TransactionResponse field to save the transaction: .to, .data',
			),
	)

	const result = await whenNotErrorAll([redis, saved], ([db]) =>
		db
			.quit()
			.then((x) => x)
			.catch((err: Error) => err),
	)

	console.log({ tx, result })

	return result instanceof Error
		? new Response(json({ message: 'error', error: result.message }), {
				status: 400,
				headers,
		  })
		: new Response(json({ message: 'success' }), { status: 200, headers })
}
