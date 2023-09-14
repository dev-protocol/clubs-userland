/* eslint-disable functional/no-return-void */
import type { APIRoute } from 'astro'
import { cors } from 'utils/json'
import {
	whenDefinedAll,
	whenNotErrorAll,
	type ErrorOr,
} from '@devprotocol/util-ts'
import Airtable, { Record, type FieldSet } from 'airtable'
import { tryCatch } from 'ramda'

const { AIRTABLE_BASE, AIRTABLE_API_KEY } = import.meta.env

// eslint-disable-next-line functional/no-expression-statements
Airtable.configure({ apiKey: AIRTABLE_API_KEY })

export const GET: APIRoute = async ({ url, params }) => {
	const query =
		whenDefinedAll(
			[url.searchParams.get('account'), url.searchParams.get('field')],
			([account, field]) => ({
				account,
				field,
			}),
		) ?? new Error('Missing required paramater: ?account, ?field')

	const optionalQuery = tryCatch(
		([conds]: [string[]]) => ({
			additionalConditions: conds.map(
				(cond) => JSON.parse(cond) as [string, string | boolean | number],
			),
		}),
		(err: Error) => err,
	)([url.searchParams.getAll('additional-conditions')])

	const props =
		whenDefinedAll([params.table], ([table]) => ({
			table,
		})) ?? new Error('Missing required path paramater: /[table]')

	const airtable = Airtable.base(AIRTABLE_BASE)

	const filterByFormula = whenNotErrorAll(
		[query, optionalQuery],
		([{ account, field }, { additionalConditions }]) =>
			`AND({${field}}="${account}", ${additionalConditions
				.map(([_f, _v]) => {
					return typeof _v === 'string'
						? `{${_f}}="${_v}"`
						: typeof _v === 'boolean'
						? _v
							? `TRUE("${_f}")`
							: `NOT(TRUE("${_f}"))`
						: `{${_f}}=${_v}`
				})
				.join(', ')})` ?? `{${field}}="${account}"`,
	)

	const result = await new Promise<ErrorOr<Record<FieldSet>>>((resolve) =>
		whenNotErrorAll(
			[query, filterByFormula, props],
			([{ account, field }, _filterByFormula, { table }]) =>
				airtable
					.table(table)
					.select({
						fields: [field],
						filterByFormula: _filterByFormula,
					})
					.firstPage((err, records) => {
						const hit = records?.find((r) => {
							const v = r.get(field)
							return v === account
						})
						return err
							? resolve(new Error(err))
							: hit
							? resolve(hit)
							: resolve(new Error('Not found'))
					}),
		),
	)

	console.log({ result, filterByFormula, props, query })

	return new Response(result instanceof Error ? '0' : '1', {
		status: 200,
		headers: cors,
	})
}
