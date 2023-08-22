import { type UndefinedOr, whenDefined } from '@devprotocol/util-ts'
import { type HDNodeWallet, JsonRpcProvider, Wallet } from 'ethers'

const { MNEMONIC } = process.env

export const createWallet = ({
	rpcUrl,
}: {
	rpcUrl: string
}): UndefinedOr<HDNodeWallet> => {
	const provider = new JsonRpcProvider(rpcUrl)
	return whenDefined(MNEMONIC, (key) => Wallet.fromPhrase(key, provider))
}
