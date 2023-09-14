export const generateTransactionKey = (to: string, data: string): string =>
	`transaction-created-time::${to}:${data}`
