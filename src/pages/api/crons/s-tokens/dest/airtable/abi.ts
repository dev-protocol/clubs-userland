export const Minted = [
	'uint256 tokenId',
	'address owner',
	'address property',
	'uint256 amount',
	'uint256 price',
]

export const Transfer = ['address from', 'address to', 'uint256 tokenId']

export const TransferTopic =
	'0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export const ABI_NFT = [
	'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
	'function tokenURI(uint256 tokenId) external view returns (string)',
	'function tokenOfOwnerByIndex(address owner, uint256 index) public view returns (uint256)',
	'function balanceOf(address owner) external view returns (uint256 balance)',
	'function ownerOf(uint256 tokenId) external view returns (address owner)',
]
