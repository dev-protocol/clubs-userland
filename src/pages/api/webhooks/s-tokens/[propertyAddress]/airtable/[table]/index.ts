/* eslint-disable functional/functional-parameters */
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
import { tryCatch } from 'ramda'
import { JsonRpcProvider } from 'ethers'
import { clientsSTokens } from '@devprotocol/dev-kit'
import { TransferTopic } from './abi'
import { createOrUpdate } from 'utils/airtable'
import pQueue from 'p-queue'

const { AIRTABLE_BASE, AIRTABLE_API_KEY, RPC_URL } = import.meta.env

// eslint-disable-next-line functional/no-expression-statements
Airtable.configure({ apiKey: AIRTABLE_API_KEY })

enum RequiredFields {
	BlockNumber = 'block',
	Account = 'account',
	MintedAt = 'time',
	TokenId = 't_id',
	TokenName = 't_name',
	TokenPayload = 't_payload',
}
enum OptionalFields {
	TokenLocked = 't_lock',
}

const qOnChainTasks = new pQueue({ concurrency: 5 })

export const maxDuration = 300

export const GET: APIRoute = async ({ url, params }) => {
	const query =
		whenDefinedAll(
			[url.searchParams.get('fields'), url.searchParams.get('primaryKey')],
			([fields, primaryKey]) => ({
				fields,
				primaryKey,
			}),
		) ?? new Error('Missing required paramater: ?fields, ?primaryKey')
	const optionalQuery = {
		fromBlock: url.searchParams.get('fromBlock'),
	}
	const props =
		whenDefinedAll(
			[params.propertyAddress, params.table],
			([propertyAddress, table]) => ({
				propertyAddress,
				table,
			}),
		) ?? new Error('Missing required path paramater: /[table]')
	const fieldsQuery = whenNotError(query, ({ fields }) =>
		tryCatch(
			(conds: string) => JSON.parse(conds) as [[string, string]],
			(err: Error) => err,
		)(fields),
	)
	const givenFields = whenNotError(fieldsQuery, (_fields) =>
		Array.isArray(_fields) && _fields.every(Array.isArray)
			? ((_f) => {
					const map = new Map(_f)
					return (
						whenDefinedAll(
							[
								map.get(RequiredFields.Account),
								map.get(RequiredFields.BlockNumber),
								map.get(RequiredFields.MintedAt),
								map.get(RequiredFields.TokenId),
								map.get(RequiredFields.TokenName),
								map.get(RequiredFields.TokenPayload),
							],
							([
								account,
								blockNumber,
								mintedAt,
								tokenId,
								tokenName,
								payload,
							]) => ({
								account,
								blockNumber,
								mintedAt,
								tokenId,
								tokenName,
								payload,
								tokenLocked: map.get(OptionalFields.TokenLocked),
							}),
						) ?? new Error('Missing some required field types')
					)
				})(_fields)
			: new Error('Unexpected fields value'),
	)

	const airtable = Airtable.base(AIRTABLE_BASE)

	const latestBlock = await new Promise<ErrorOr<number>>((resolve) => {
		const res = whenNotErrorAll(
			[props, givenFields],
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

	const nextBlock = optionalQuery.fromBlock
		? BigInt(optionalQuery.fromBlock)
		: latestBlock instanceof Error
			? 'latest'
			: latestBlock + 1

	console.log({ latestBlock, nextBlock })

	const provider = new JsonRpcProvider(RPC_URL)
	const [l1, l2] = await clientsSTokens(provider)
	const client = l1 ?? l2 ?? new Error('Failed to load sTokens')
	const sTokensContract = whenNotError(client, (c) => c.contract())
	const eventsOnChain =
		(await whenNotError(sTokensContract, async (contract) => {
			return contract
				.queryFilter(contract.filters.Minted, nextBlock)
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
					const owner = encTransfer?.[1] as UndefinedOr<string>
					const encMinted = contract.interface.decodeEventLog(
						'Minted',
						event.data,
						event.topics,
					)
					const block = await qOnChainTasks.add(() =>
						provider.getBlock(event.blockNumber),
					)
					const timestamp = whenDefined(block, (b) =>
						new Date(b && b.timestamp * 1000).toISOString(),
					)
					const tokenId = encMinted[0] as bigint
					const property = encMinted[2] as string
					return { tokenId, event, timestamp, property, owner }
				}),
			)
			return res
		},
	)

	const filterdEvents = await whenNotErrorAll(
		[eventsExtended, client, props],
		async ([logs, contract, { propertyAddress }]) => {
			const metadatas = await Promise.all(
				logs.map(async ({ tokenId, ...left }) => {
					const id = Number(tokenId)
					const metadata = await qOnChainTasks.add(() => contract.tokenURI(id))
					return { tokenId, metadata, ...left }
				}),
			)
			const property = propertyAddress.toLowerCase()
			const res = metadatas.filter((meta) => {
				return meta.property.toLowerCase() === property
			})
			return res
		},
	)

	const newRecords = whenNotErrorAll(
		[givenFields, filterdEvents],
		([
			{
				account,
				blockNumber,
				mintedAt,
				tokenId,
				tokenName,
				payload,
				tokenLocked,
			},
			_events,
		]) =>
			_events.map((ev) => ({
				[account]: ev.owner ?? '',
				[blockNumber]: ev.event.blockNumber,
				[mintedAt]: ev.timestamp ?? '',
				[tokenId]: Number(ev.tokenId),
				[tokenName]: ev.metadata?.name ?? '',
				[payload]:
					ev.metadata?.attributes.find((x) => x.trait_type === 'Payload')
						?.value ?? '',
				...(tokenLocked
					? {
							[tokenLocked]:
								ev.metadata?.attributes.find(
									(x) => x.trait_type === 'Locked Amount',
								)?.value ?? '',
						}
					: {}),
			})),
	)

	console.log({ newRecords })

	const result = await whenNotErrorAll(
		[props, query, newRecords],
		([{ table }, { primaryKey }, records]) =>
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
