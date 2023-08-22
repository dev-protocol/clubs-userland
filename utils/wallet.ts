import type { UndefinedOr } from '@devprotocol/util-ts'
import { whenDefined } from '@devprotocol/util-ts'
import type { HDNodeWallet } from 'ethers'
import { JsonRpcProvider, Wallet } from 'ethers'

export const createWallet = ({
	rpcUrl,
}: {
	rpcUrl: string
}): UndefinedOr<HDNodeWallet> => {
	const { MNEMONIC } = import.meta.env

	const provider = new JsonRpcProvider(rpcUrl)
	return whenDefined(MNEMONIC, (key) => Wallet.fromPhrase(key, provider))
}
