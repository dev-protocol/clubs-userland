export type JSON = Readonly<
	Record<
		string,
		| string
		| boolean
		| number
		| undefined
		| null
		| Readonly<Record<string, string | boolean | number | undefined | null>>
	>
>

export const json = (json: JSON): string => JSON.stringify(json)

export const headers = {
	'content-type': 'application/json;charset=UTF-8',
}
