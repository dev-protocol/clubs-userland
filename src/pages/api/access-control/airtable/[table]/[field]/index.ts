/* eslint-disable functional/no-return-void */
import type { APIRoute } from 'astro'
import { cors } from 'utils/json'
import {
	whenDefinedAll,
	whenNotErrorAll,
	type ErrorOr,
	whenNotError,
} from '@devprotocol/util-ts'
import Airtable, { Record, type FieldSet } from 'airtable'
import { tryCatch } from 'ramda'
import { getFieldNameById } from 'utils/airtable'

const { AIRTABLE_BASE, AIRTABLE_API_KEY } = import.meta.env

// eslint-disable-next-line functional/no-expression-statements
Airtable.configure({ apiKey: AIRTABLE_API_KEY })

export const GET: APIRoute = async ({ url, params }) => {
	const query =
		whenDefinedAll([url.searchParams.get('account')], ([account]) => ({
			account,
		})) ?? new Error('Missing required paramater: ?account')

	const optionalQuery = tryCatch(
		([conds]: [string[]]) => ({
			additionalConditions: conds.map(
				(cond) => JSON.parse(cond) as [string, string | boolean | number],
			),
		}),
		(err: Error) => err,
	)([url.searchParams.getAll('additional-conditions')])

	const props =
		whenDefinedAll([params.table, params.field], ([table, field]) => ({
			table,
			field,
		})) ?? new Error('Missing required path paramater: /[table]/[field]')

	const airtable = Airtable.base(AIRTABLE_BASE)

	const fieldName = await whenNotError(props, ({ table, field }) => {
		return getFieldNameById({ base: airtable, id: field, table })
	})

	const additionalConditions = await whenNotErrorAll(
		[optionalQuery, props],
		async ([{ additionalConditions }, { table }]) => {
			const res = await Promise.all(
				additionalConditions.map<
					Promise<[ErrorOr<string>, string | number | boolean]>
				>(async ([field, value]) => {
					const name = await getFieldNameById({
						base: airtable,
						id: field,
						table,
					})
					return [name, value]
				}),
			)
			const error = res.find(([x]) => x instanceof Error)
			return error
				? (error[0] as Error)
				: (res as [[string, string | number | boolean]])
		},
	)

	const filterByFormula = whenNotErrorAll(
		[query, additionalConditions, fieldName],
		([{ account }, conditions, field]) =>
			conditions.length > 0
				? `AND({${field}}="${account}", ${conditions
						.map(([_f, _v]) => {
							return typeof _v === 'string'
								? `{${_f}}="${_v}"`
								: typeof _v === 'boolean'
								? _v
									? `TRUE("${_f}")`
									: `NOT(TRUE("${_f}"))`
								: `{${_f}}=${_v}`
						})
						.join(', ')})`
				: `{${field}}="${account}"`,
	)

	const result = await new Promise<ErrorOr<Record<FieldSet>>>((resolve) => {
		const res = whenNotErrorAll(
			[query, filterByFormula, props, fieldName],
			([{ account }, _filterByFormula, { table }, field]) =>
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
		)
		return res instanceof Error ? resolve(res) : undefined
	})

	console.log({ result, filterByFormula, props, query })

	return new Response(result instanceof Error ? '0' : '1', {
		status: 200,
		headers: cors,
	})
}
