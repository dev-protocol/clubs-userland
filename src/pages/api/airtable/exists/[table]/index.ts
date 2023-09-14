/* eslint-disable functional/no-return-void */
import type { APIRoute } from 'astro'
import { json, headers } from 'utils/json'
import { whenDefinedAll, whenNotErrorAll } from '@devprotocol/util-ts'
import Airtable, { Record, type FieldSet } from 'airtable'

const { AIRTABLE_BASE, AIRTABLE_API_KEY } = import.meta.env

// eslint-disable-next-line functional/no-expression-statements
Airtable.configure({ apiKey: AIRTABLE_API_KEY })

export const GET: APIRoute = async ({ url, params }) => {
	const query =
		whenDefinedAll(
			[url.searchParams.get('account'), url.searchParams.get('field')],
			([account, field]) => ({ account, field }),
		) ?? new Error('Missing required paramater: ?account, ?field')

	console.log({ query })

	const props =
		whenDefinedAll([params.table], ([table]) => ({
			table,
		})) ?? new Error('Missing required path paramater: /[table]/')
	console.log({ props })

	const airtable = Airtable.base(AIRTABLE_BASE)

	const item = await new Promise<Record<FieldSet>>((resolve) =>
		whenNotErrorAll([query, props], ([{ account, field }, { table }]) =>
			airtable
				.table(table)
				.select({
					fields: [field],
					filterByFormula: `{${field}}=${account}`,
				})
				.eachPage(
					(records, fetchNextPage) => {
						console.log(records)
						const hit = records.find((r) => {
							const v = r.get(field)
							console.log(v)
							return v === account
						})
						return hit ? resolve(hit) : fetchNextPage()
					},
					function done(err: Error) {
						return err
					},
				),
		),
	)

	console.log({ item })

	return item instanceof Error
		? new Response(json({ message: 'error', error: item.message }), {
				status: 400,
				headers,
		  })
		: new Response(json({ message: 'success' }), { status: 200, headers })
}
