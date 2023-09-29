/* eslint-disable functional/no-return-void */
import type { APIRoute } from 'astro'
import { cors } from 'utils/json'
import {
	whenDefinedAll,
	whenNotErrorAll,
	type ErrorOr,
	whenNotError,
	type UndefinedOr,
} from '@devprotocol/util-ts'
import Airtable, { type FieldSet, type Records } from 'airtable'
import { splitEvery, tryCatch } from 'ramda'
import { AbiCoder, EventLog, JsonRpcProvider, Log } from 'ethers'
import { clientsSTokens } from '@devprotocol/dev-kit'
import { Minted } from './abi'

const { AIRTABLE_BASE, AIRTABLE_API_KEY, RPC_URL } = import.meta.env

// eslint-disable-next-line functional/no-expression-statements
Airtable.configure({ apiKey: AIRTABLE_API_KEY })

enum RequiredFields {
	BlockNumber = 'block',
	Account = 'account',
	TokenId = 't_id',
	TokenName = 't_name',
	TokenPayload = 't_payload',
}

export const GET: APIRoute = async ({ url, params }) => {
	const query =
		whenDefinedAll([url.searchParams.get('fields')], ([fields]) => ({
			fields,
		})) ?? new Error('Missing required paramater: ?fields')
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
								map.get(RequiredFields.TokenId),
								map.get(RequiredFields.TokenName),
								map.get(RequiredFields.TokenPayload),
							],
							([account, blockNumber, tokenId, tokenName, payload]) => ({
								account,
								blockNumber,
								tokenId,
								tokenName,
								payload,
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
	const events =
		(await whenNotError(sTokensContract, async (contract) => {
			return contract
				.queryFilter(contract.filters.Minted, nextBlock)
				.catch((err) => new Error(err))
		})) ?? new Error('Failed to create contract client')

	const eventsWithTokenIds = await whenNotErrorAll([events], async ([evs]) => {
		const res = await Promise.all(
			evs.map(async (event) => {
				const encoded = tryCatch(
					(data: string) => AbiCoder.defaultAbiCoder().decode(Minted, data),
					(err: Error) => err,
				)(event.data)
				const tokenId = whenNotError(encoded, ([v]) => v as bigint)
				return { tokenId, event }
			}),
		)
		const allGreen = res.every(({ tokenId }) => typeof tokenId === 'bigint')
		return allGreen
			? (res as { tokenId: bigint; event: EventLog | Log }[])
			: new Error('Failed to parse some events')
	})

	const filterdEvents = await whenNotErrorAll(
		[eventsWithTokenIds, client, props],
		async ([logs, contract, { propertyAddress }]) => {
			const metadatas = await Promise.all(
				logs.map(async ({ tokenId, event }) => {
					const id = Number(tokenId)
					const [metadata, owner] = await Promise.all([
						contract.tokenURI(id),
						contract.ownerOf(id),
					])
					return { tokenId, metadata, owner, event }
				}),
			)
			const property = propertyAddress.toLowerCase()
			const res = metadatas.filter((meta) => {
				const dest = meta.metadata.attributes.find(
					(x) => x.trait_type === 'Destination',
				)?.value as UndefinedOr<string>
				return dest?.toLowerCase() === property
			})
			return res
		},
	)

	const newRecords = whenNotErrorAll(
		[givenFields, filterdEvents],
		([{ account, blockNumber, tokenId, tokenName, payload }, _events]) =>
			_events.map((ev) => ({
				fields: {
					[account]: ev.owner,
					[blockNumber]: ev.event.blockNumber,
					[tokenId]: Number(ev.tokenId),
					[tokenName]: ev.metadata.name,
					[payload]:
						ev.metadata.attributes.find((x) => x.trait_type === 'Payload')
							?.value ?? '',
				},
			})),
	)

	console.log({ newRecords })

	const result = await new Promise<ErrorOr<Records<FieldSet> | undefined>>(
		(resolve) => {
			const res = whenNotErrorAll(
				[props, newRecords],
				([{ table }, records]) => {
					const fieldsSet = splitEvery(10, records)
					const tmp = new Set<Records<FieldSet>>()
					return fieldsSet.length > 0
						? fieldsSet.map((fields, index) =>
								airtable.table(table).create(fields, (err, records) => {
									// eslint-disable-next-line functional/no-expression-statements
									records && tmp.add(records)
									return err
										? resolve(new Error(err))
										: index === fieldsSet.length
										? resolve(Array.from(tmp).flat())
										: undefined
								}),
						  )
						: resolve([])
				},
			)
			return res instanceof Error ? resolve(res) : undefined
		},
	)

	console.log({ result })

	return new Response(events instanceof Error ? '0' : '1', {
		status: 200,
		headers: cors,
	})
}
