import type { UndefinedOr } from '@devprotocol/util-ts'
import { whenDefined } from '@devprotocol/util-ts'
import type { HDNodeWallet } from 'ethers'
import { JsonRpcProvider, Wallet } from 'ethers'

const { MNEMONIC } = process.env

export const createWallet = ({
	rpcUrl,
}: {
	rpcUrl: string
}): UndefinedOr<HDNodeWallet> => {
	const provider = new JsonRpcProvider(rpcUrl)
	return whenDefined(MNEMONIC, (key) => Wallet.fromPhrase(key, provider))
}
