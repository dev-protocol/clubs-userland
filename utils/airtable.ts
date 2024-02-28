/* eslint-disable functional/type-declaration-immutability */
/* eslint-disable functional/no-return-void */
import { whenDefined, type ErrorOr } from '@devprotocol/util-ts'
import type { FieldSet, Records } from 'airtable'
import type { AirtableBase } from 'airtable/lib/airtable_base'
import { splitEvery } from 'ramda'

type FieldValue = string | number | boolean

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

const saveHandler = (
	resolver: (value: ErrorOr<Records<FieldSet>>) => void,
	count: number,
) => {
	// eslint-disable-next-line functional/no-let
	let counter = 0
	const tmp = new Set<Records<FieldSet>>()
	return (err: Error, records: Records<FieldSet> | undefined) => {
		counter = counter + (records?.length ?? 0)
		records && tmp.add(records)
		return err
			? resolver(err)
			: counter === count
				? resolver(Array.from(tmp).flat())
				: undefined
	}
}

export const create = async (opts: {
	base: AirtableBase
	table: string
	data: { fields: Record<string, FieldValue> }[]
}) => {
	const allData = splitEvery(10, opts.data)
	return new Promise<ErrorOr<Records<FieldSet>>>((resolve) => {
		const handler = saveHandler(resolve, opts.data.length)
		return allData.length > 0
			? allData.map((fields) =>
					opts.base.table(opts.table).create(fields, handler),
				)
			: resolve([])
	})
}

export const update = async (opts: {
	base: AirtableBase
	table: string
	data: { id: string; fields: Record<string, FieldValue> }[]
}) => {
	const allData = splitEvery(10, opts.data)
	return new Promise<ErrorOr<Records<FieldSet>>>((resolve) => {
		const handler = saveHandler(resolve, opts.data.length)
		return allData.length > 0
			? allData.map((fields) =>
					opts.base.table(opts.table).update(fields, handler),
				)
			: resolve([])
	})
}

export const createOrUpdate = async <
	R extends Record<string, FieldValue>,
	F extends R[],
>({
	base,
	table,
	...opts
}: {
	base: AirtableBase
	table: string
	records: F
	key: string
}) => {
	type E = { data: R; result: Records<FieldSet> }
	type N = { data: R; result: undefined }

	const key = String(opts.key)
	const findExistingRecords = (data: R) =>
		new Promise<E | N>((resolve) =>
			base
				.table(table)
				.select({
					fields: [key],
					filterByFormula: `{${key}}="${data[key]}"`,
					maxRecords: 1,
				})
				.firstPage((err, records) => {
					return err
						? resolve({ data, result: undefined })
						: resolve({
								data,
								result: records && records.length ? records : undefined,
							})
				}),
		)
	const existingOrNot = await Promise.all(opts.records.map(findExistingRecords))
	const forCreating = existingOrNot.reduce(
		(pv, cv) => [...pv, ...(cv.result ? [] : [cv])],
		[] as N[],
	)
	const forUpdating = existingOrNot.reduce(
		(pv, cv) => [...pv, ...(cv.result ? [cv] : [])],
		[] as E[],
	)
	const listCreate = forCreating.map(({ data }) => ({ fields: data }))
	const listUpdate = forUpdating.map(({ data, result }) => ({
		fields: data,
		id: result.find((x) => x.id)?.id ?? '',
	}))

	const result = await Promise.all([
		create({ base, table, data: listCreate }),
		update({ base, table, data: listUpdate }),
	])
		.then((res) => res.flat())
		.catch((err: Error) => err)

	return result
}
