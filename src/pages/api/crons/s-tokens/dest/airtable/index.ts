/* eslint-disable functional/no-return-void */
import type { APIRoute } from 'astro'
import { cors, headers, json } from 'utils/json'
import {
	whenDefinedAll,
	whenNotErrorAll,
	type ErrorOr,
	whenNotError,
	whenDefined,
	type UndefinedOr,
} from '@devprotocol/util-ts'
import Airtable from 'airtable'
import { always, tryCatch } from 'ramda'
import { Contract, JsonRpcProvider } from 'ethers'
import { clientsSTokens } from '@devprotocol/dev-kit'
import { ABI_NFT, TransferTopic } from './abi'
import { createOrUpdate } from 'utils/airtable'
import pQueue from 'p-queue'
import { fetchMetadatas, transferEvents } from 'utils/logs'

const {
	AIRTABLE_BASE,
	AIRTABLE_API_KEY,
	RPC_URL,
	PROPERTY_ADDRESS,
	CRON_STOKENS_FIELDS,
	CRON_STOKENS_PRIMARY_KEY,
	CRON_STOKENS_TABLE,
	RPC_MAX_CONCURRENCY,
	CRON_ADDITIONAL_NFTS,
} = import.meta.env

// eslint-disable-next-line functional/no-expression-statements
Airtable.configure({ apiKey: AIRTABLE_API_KEY })

enum RequiredFields {
	BlockNumber = 'block',
	Account = 'account',
	MintedAt = 'time',
	TokenName = 't_name',
	TokenPayload = 't_payload',
}
enum OptionalFields {
	TokenId = 't_id',
	TokenLocked = 't_lock',
	UniqueId = 'u_id',
	Contract = 'contract',
}

type FiledsEnv = Readonly<{
	[RequiredFields.BlockNumber]: string
	[RequiredFields.Account]: string
	[RequiredFields.MintedAt]: string
	[RequiredFields.TokenName]: string
	[RequiredFields.TokenPayload]: string
	[OptionalFields.TokenId]?: string
	[OptionalFields.TokenLocked]?: string
	[OptionalFields.UniqueId]?: string
	[OptionalFields.Contract]?: string
}>

const qOnChainTasks = new pQueue({
	concurrency: RPC_MAX_CONCURRENCY ? Number(RPC_MAX_CONCURRENCY) : 5,
})

const maxBlock = 5000000

const uid = (address: string, tokenId: string | number | bigint) =>
	`${address}#${tokenId.toString()}`

export const maxDuration = 300

export const GET: APIRoute = async ({ url }) => {
	const optionalQuery = {
		fromBlock: url.searchParams.get('fromBlock'),
		toBlock: url.searchParams.get('toBlock'),
	}
	const envs =
		whenDefinedAll(
			[
				PROPERTY_ADDRESS,
				CRON_STOKENS_TABLE,
				CRON_STOKENS_FIELDS,
				CRON_STOKENS_PRIMARY_KEY,
			],
			([propertyAddress, table, fields, primaryKey]) => ({
				propertyAddress,
				table,
				fields,
				primaryKey,
			}),
		) ??
		new Error(
			'Missing required env: PROPERTY_ADDRESS, CRON_STOKENS_TABLE, CRON_STOKENS_FIELDS, CRON_STOKENS_PRIMARY_KEY',
		)
	const fieldsEnv = whenNotError(envs, ({ fields }) =>
		tryCatch(
			(conds: string) => JSON.parse(conds) as FiledsEnv,
			(err: Error) => err,
		)(fields),
	)

	const givenFields = whenNotError(fieldsEnv, (_fields) =>
		((_f) => {
			return (
				whenDefinedAll(
					[
						_f[RequiredFields.Account],
						_f[RequiredFields.BlockNumber],
						_f[RequiredFields.MintedAt],
						_f[RequiredFields.TokenName],
						_f[RequiredFields.TokenPayload],
					],
					([account, blockNumber, mintedAt, tokenName, payload]) => ({
						account,
						blockNumber,
						mintedAt,
						tokenName,
						payload,
						tokenLocked: _f[OptionalFields.TokenLocked],
						tokenId: _f[OptionalFields.TokenId],
						uniqueId: _f[OptionalFields.UniqueId],
						contract: _f[OptionalFields.Contract],
					}),
				) ?? new Error('Missing some required field types')
			)
		})(_fields),
	)

	const airtable = Airtable.base(AIRTABLE_BASE)

	const latestBlock = await new Promise<ErrorOr<number>>((resolve) => {
		const res = whenNotErrorAll(
			[envs, givenFields],
			([{ table }, { blockNumber }]) =>
				airtable
					.table(table)
					.select({
						fields: [blockNumber],
						sort: [{ field: blockNumber, direction: 'desc' }],
						maxRecords: 1,
					})
					.firstPage((err, records) => {
						const hit = records?.find((r) => r.get(blockNumber))
						const number = Number(hit?.get(blockNumber))
						return err
							? resolve(new Error(err))
							: typeof number === 'number' && !isNaN(number)
								? resolve(number)
								: resolve(new Error('Not found'))
					}),
		)
		return res instanceof Error ? resolve(res) : undefined
	})

	const provider = new JsonRpcProvider(RPC_URL)
	const currentBlock = await provider.getBlockNumber()
	const fromBlock = optionalQuery.fromBlock
		? BigInt(optionalQuery.fromBlock)
		: latestBlock instanceof Error
			? currentBlock - maxBlock
			: ((fallbackBlock) =>
					latestBlock > fallbackBlock ? latestBlock : fallbackBlock)(
					currentBlock - maxBlock,
				)
	const toBlock = optionalQuery.toBlock
		? BigInt(optionalQuery.toBlock)
		: ((maxCurrentBlock) =>
					currentBlock < maxCurrentBlock ? currentBlock : maxCurrentBlock)(
					Number(fromBlock) + maxBlock,
				)

	console.log({ latestBlock, fromBlock, toBlock })

	const [l1, l2] = await clientsSTokens(provider)
	const client = l1 ?? l2 ?? new Error('Failed to load sTokens')
	const sTokensContract = whenNotError(client, (c) => c.contract())
	const eventsOnChain =
		(await whenNotError(sTokensContract, async (contract) => {
			return contract
				.queryFilter(contract.filters.Minted, fromBlock, toBlock)
				.catch((err) => new Error(err))
		})) ?? new Error('Failed to create contract client')

	const eventsExtended = await whenNotErrorAll(
		[eventsOnChain, sTokensContract],
		async ([evs, contract]) => {
			const res = await Promise.all(
				evs.map(async (event) => {
					const tx = await qOnChainTasks.add(() =>
						event.getTransactionReceipt(),
					)
					const lastTransfer = tx?.logs
						.filter((log) => log.topics[0] === TransferTopic)
						?.reduce((pv, log) => (pv.index < log.index ? log : pv))
					const encTransfer = whenDefined(lastTransfer, (trns) =>
						contract.interface.decodeEventLog(
							'Transfer',
							trns.data,
							trns.topics,
						),
					)
					const from = encTransfer?.[0] as UndefinedOr<string>
					const to = encTransfer?.[1] as UndefinedOr<string>
					const encMinted = contract.interface.decodeEventLog(
						'Minted',
						event.data,
						event.topics,
					)
					const block = event.blockNumber
					const tokenId = encMinted[0] as bigint
					const property = encMinted[2] as string
					const contractAddress = await contract.getAddress()
					return { tokenId, event, property, from, to, block, contractAddress }
				}),
			)
			return res
		},
	)

	const eventsWithMeta = await whenNotErrorAll(
		[eventsExtended, sTokensContract],
		([events, contract]) =>
			fetchMetadatas({
				provider,
				contract,
				logs: events,
				queue: qOnChainTasks,
			}),
	)

	const filterdEvents = await whenNotErrorAll(
		[eventsWithMeta, envs],
		async ([logs, { propertyAddress }]) => {
			const property = propertyAddress.toLowerCase()
			const res = logs.filter((log) => {
				return log.property.toLowerCase() === property
			})
			return res
		},
	)

	const nftAddresses =
		whenDefined(CRON_ADDITIONAL_NFTS, (value) =>
			tryCatch((v: string) => JSON.parse(v) as string[], always([]))(value),
		) ?? []
	const nfts = nftAddresses.map(
		(address) => new Contract(address, ABI_NFT, provider),
	)
	const nftEvents = await Promise.all(
		nfts.map(async (contract) =>
			fetchMetadatas({
				provider,
				contract,
				logs: await transferEvents({
					contract,
					fromBlock,
					toBlock,
					queue: qOnChainTasks,
				}),
				queue: qOnChainTasks,
			}),
		),
	)
	const allNftEventsFlat = whenNotErrorAll(
		[filterdEvents, nftEvents],
		([e1, e2]) => [...e1, ...e2.flat()],
	)

	const newRecords = whenNotErrorAll(
		[givenFields, allNftEventsFlat],
		([
			{
				account,
				blockNumber,
				mintedAt,
				tokenId,
				tokenName,
				payload,
				tokenLocked,
				uniqueId,
				contract,
			},
			_events,
		]) =>
			_events.map((ev) => ({
				[account]: ev.owner ?? '',
				[blockNumber]: ev.event.blockNumber,
				[mintedAt]: ev.timestamp ?? '',
				[tokenName]: ev.metadata?.name ?? '',
				[payload]:
					ev.metadata?.attributes.find((x) => x.trait_type === 'Payload')
						?.value ?? '',
				...(tokenId
					? {
							[tokenId]: Number(ev.tokenId),
						}
					: {}),
				...(tokenLocked
					? {
							[tokenLocked]:
								ev.metadata?.attributes.find(
									(x) => x.trait_type === 'Locked Amount',
								)?.value ?? '',
						}
					: {}),
				...(uniqueId
					? {
							[uniqueId]: uid(ev.contractAddress, ev.tokenId),
						}
					: {}),
				...(contract
					? {
							[contract]: ev.contractAddress,
						}
					: {}),
			})),
	)

	console.log({ newRecords })

	const result = await whenNotErrorAll(
		[envs, newRecords],
		([{ table, primaryKey }, records]) =>
			createOrUpdate({
				base: airtable,
				table,
				records: records,
				key: primaryKey,
			}),
	)

	console.log({ result })

	return result instanceof Error
		? new Response(json({ error: result.message }), {
				status: 400,
				headers: { ...headers, ...cors },
			})
		: new Response(json(result), {
				status: 200,
				headers: { ...headers, ...cors },
			})
}
