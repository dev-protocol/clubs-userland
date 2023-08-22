const { API_KEY } = import.meta.env

export const auth = (req: Request): boolean => {
	const key = req.headers.get('authorization')?.replace(/Bearer(\s)+/i, '')
	return key === API_KEY
}
