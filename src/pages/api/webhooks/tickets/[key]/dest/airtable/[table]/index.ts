/* eslint-disable functional/no-return-void */
import type { APIRoute } from 'astro'
import { cors, json } from 'utils/json'
import {
	whenDefinedAll,
	whenNotErrorAll,
	type ErrorOr,
	whenNotError,
	whenDefined,
} from '@devprotocol/util-ts'
import Airtable, { type FieldSet, type Records } from 'airtable'
import { keys, mergeAll, tryCatch } from 'ramda'
import type { ReadonlyDeep } from 'type-fest'

const {
	AIRTABLE_BASE,
	AIRTABLE_API_KEY,
	WEBHOOK_TICKETS_KEY,
	WEBHOOK_TICKETS_FIELDS,
} = import.meta.env

type RequestBody = ReadonlyDeep<{
	status: 'used'
	id: string // sTokens ID
	account: string // EOA
	benefit: { id: string; description: string }
}>

type TicketsFields = ReadonlyDeep<{
	status?: string
	id?: string
	account?: string
	benefit_id?: string
	benefit_description?: string
}>

// eslint-disable-next-line functional/no-expression-statements
Airtable.configure({ apiKey: AIRTABLE_API_KEY })

export const POST: APIRoute = async ({ params, request }) => {
	const body = await request
		.json()
		.then((x) => x as RequestBody)
		.catch((err) => new Error(err))

	const props =
		whenDefinedAll([params.key, params.table], ([key, table]) => ({
			key,
			table,
		})) ??
		new Error('Missing required path paramater: /[key]/dest/airtable/[table]')

	const isValidKey = whenNotError(props, ({ key }) =>
		key === WEBHOOK_TICKETS_KEY ? true : new Error('Invalid key'),
	)

	const airtable = Airtable.base(AIRTABLE_BASE)

	const mapToFields =
		whenDefined(
			WEBHOOK_TICKETS_FIELDS,
			tryCatch(
				(str: string) => JSON.parse(str),
				(err: Error) => err,
			),
		) ?? new Error('WEBHOOK_TICKETS_FIELDS is missing')

	const parsedMap = whenNotError(
		mapToFields,
		(x) =>
			({
				status: x.status,
				id: x.id,
				account: x.account,
				benefit_id: x.benefit_id,
				benefit_description: x.benefit_description,
			}) as TicketsFields,
	)

	const parsedMapKeys = whenNotError(parsedMap, (map) => keys(map))

	const computedFields = whenNotErrorAll(
		[body, parsedMap, parsedMapKeys],
		([{ status, id, account, benefit }, _map, _keys]) =>
			_keys.map((key) =>
				typeof _map[key] === 'string'
					? {
							[_map[key] as string]:
								key === 'account'
									? account
									: key === 'status'
									? status
									: key === 'id'
									? id
									: key === 'benefit_id'
									? benefit.id
									: key === 'benefit_description'
									? benefit.description
									: undefined,
					  }
					: undefined,
			),
	)

	const fields = whenNotError(computedFields, (cf) =>
		mergeAll(cf.filter((x) => x !== undefined) as TicketsFields[]),
	)

	const result = await new Promise<ErrorOr<Records<FieldSet> | undefined>>(
		(resolve) => {
			const res = whenNotErrorAll(
				[props, fields, isValidKey],
				([{ table }, _fields]) =>
					airtable.table(table).create(
						[
							{
								fields: _fields,
							},
						],
						(err, records) => {
							return err ? resolve(new Error(err)) : resolve(records)
						},
					),
			)
			return res instanceof Error ? resolve(res) : undefined
		},
	)

	console.log({ result })

	return new Response(
		result instanceof Error
			? json({ message: result.message })
			: json({ message: 'success', data: result }),
		{
			status: result instanceof Error ? 400 : 200,
			headers: cors,
		},
	)
}
