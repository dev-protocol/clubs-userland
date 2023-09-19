export const json = (json: unknown): string => JSON.stringify(json)

export const headers = {
	'content-type': 'application/json;charset=UTF-8',
}

export const cors = {
	'access-control-allow-origin': '*',
}
