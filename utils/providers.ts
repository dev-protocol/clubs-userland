import { FallbackProvider, JsonRpcProvider } from 'ethers'

export const publicPolygonProvider = new FallbackProvider(
	[
		new JsonRpcProvider('https://polygon-rpc.com'),
		new JsonRpcProvider('https://polygon-bor-rpc.publicnode.com'),
	],
	137, // Polygon mainnet chain ID
)
