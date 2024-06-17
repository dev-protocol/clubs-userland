/* eslint-disable functional/functional-parameters */
import { whenDefined } from '@devprotocol/util-ts'
import {
	decodeBase64,
	EventLog,
	Log,
	toUtf8String,
	type Contract,
	type Provider,
} from 'ethers'
import type PQueue from 'p-queue'
import { tryCatch } from 'ramda'

export type TransferEvent = Readonly<{
	from?: string
	to?: string
	tokenId: string | bigint
	block: number | string
	event: Log | EventLog
	contractAddress: string
}>
// eslint-disable-next-line functional/type-declaration-immutability
export type TransferEvents = Readonly<TransferEvent[]>

// eslint-disable-next-line functional/type-declaration-immutability
type Metadata = Readonly<{
	name: string
	description: string
	image: string
	attributes: ReadonlyArray<Readonly<{ trait_type: string; value: string }>>
}>

export const transferEvents = async ({
	contract,
	fromBlock,
	toBlock,
	queue,
}: {
	contract: Contract
	fromBlock: number | bigint | string
	toBlock?: number | bigint | string
	queue: PQueue
}): Promise<TransferEvents> => {
	const event = contract.filters.Transfer()
	const contractAddress = await contract.getAddress()
	const logs =
		(await queue.add(() => contract.queryFilter(event, fromBlock, toBlock))) ??
		[]
	const sorted = [...logs].sort((a, b) => a.index - b.index)
	const res = sorted.map((event) => {
		const [from, to, tokenId] = contract.interface.decodeEventLog(
			'Transfer',
			event.data,
			event.topics,
		)
		const data = {
			from,
			to,
			tokenId,
			block: event.blockNumber,
			event,
			contractAddress,
		} as TransferEvent
		return data
	})

	return res
}

export const fetchMetadatas = async <L extends TransferEvent = TransferEvent>({
	provider,
	contract,
	logs,
	queue,
}: {
	provider: Provider
	contract: Contract
	logs: ReadonlyArray<L>
	queue: PQueue
}): Promise<
	ReadonlyArray<L & { owner?: string; timestamp?: string; metadata: Metadata }>
> => {
	const res = await Promise.all(
		logs.map(async (log) => {
			const block = await queue.add(() => provider.getBlock(log.block))
			const timestamp = whenDefined(block, (b) =>
				new Date(b && b.timestamp * 1000).toISOString(),
			)
			const uri = await queue.add(() => contract.tokenURI(log.tokenId))
			const decoded = toUtf8String(
				decodeBase64(
					uri
						.replace(
							/^data(\s+)?:(\s+)?application(\s+)?\/(\s+)?json(\s+)?;(\s+)?base64(\s+)?,(.*)/,
							'$8',
						)
						.trim(),
				),
			)
			const metadata = tryCatch(
				(m: string) => JSON.parse(m) as Metadata,
				(err) => {
					console.error(err, log)
					return {} as Metadata
				},
			)(decoded)
			return { ...log, owner: log.to, timestamp, metadata }
		}),
	)
	return res
}
