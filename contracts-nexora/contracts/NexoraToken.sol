// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Plain ERC20 used for Nexora's testnet-only tokens (Nova, Fusion,
/// Vertex, Orbit). Mints the full initial supply to the deployer once, at
/// deploy time - no further minting, no admin controls. Anything beyond that
/// isn't needed for a Sepolia testnet listing token.
contract NexoraToken is ERC20 {
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) {
        _mint(msg.sender, initialSupply_ * 10 ** decimals());
    }
}
