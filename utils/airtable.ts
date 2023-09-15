/* eslint-disable functional/no-return-void */
import { whenDefined, type ErrorOr } from '@devprotocol/util-ts'
import type { AirtableBase } from 'airtable/lib/airtable_base'

export const getFieldNameById = async (opts: {
	base: AirtableBase
	id: string
	table: string
}): Promise<ErrorOr<string>> => {
	return new Promise<ErrorOr<string>>((resolve) =>
		opts.base
			.table(opts.table)
			.select({ fields: [opts.id], maxRecords: 1 })
			.firstPage((err, records) => {
				const names = records?.map((r) => Object.keys(r.fields)) ?? [[]]
				const [[name]] = names
				return err
					? resolve(new Error(err))
					: whenDefined(name, (name) => resolve(name)) ??
							resolve(new Error(`Faild to fetch the field name: ${opts.id}`))
			}),
	)
}
