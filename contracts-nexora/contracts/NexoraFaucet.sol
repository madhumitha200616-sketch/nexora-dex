// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Testnet faucet for Nexora's 4 custom tokens (Nova, Fusion,
/// Vertex, Orbit). Gives out a fixed amount per claim, once per wallet per
/// token per 24h - enforced on-chain (not just in the frontend), so it
/// can't be bypassed by calling this contract directly. Pays out of its own
/// token balance - top up with a normal ERC20 transfer, never mints.
contract NexoraFaucet is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant CLAIM_AMOUNT = 100 * 1e18; // 100 whole tokens (all 4 use 18 decimals)
    uint256 public constant CLAIM_COOLDOWN = 24 hours;

    // token => wallet => last claim timestamp
    mapping(address => mapping(address => uint256)) public lastClaimTime;

    event Claimed(address indexed user, address indexed token, uint256 amount);
    event ReserveWithdrawn(address indexed token, uint256 amount, address indexed to);

    error TooSoon(uint256 secondsRemaining);
    error InsufficientFaucetReserve(address token, uint256 needed, uint256 available);

    function claim(address token) external {
        uint256 last = lastClaimTime[token][msg.sender];
        if (last != 0 && block.timestamp < last + CLAIM_COOLDOWN) {
            revert TooSoon((last + CLAIM_COOLDOWN) - block.timestamp);
        }

        uint256 available = IERC20(token).balanceOf(address(this));
        if (available < CLAIM_AMOUNT) {
            revert InsufficientFaucetReserve(token, CLAIM_AMOUNT, available);
        }

        // Effects before interaction - the cooldown is locked in before the
        // transfer, so this can't be re-entered to claim twice.
        lastClaimTime[token][msg.sender] = block.timestamp;
        IERC20(token).safeTransfer(msg.sender, CLAIM_AMOUNT);

        emit Claimed(msg.sender, token, CLAIM_AMOUNT);
    }

    /// @notice Seconds until `user` can claim `token` again - 0 if they can
    /// claim right now (including if they've never claimed before).
    function timeUntilNextClaim(address token, address user) external view returns (uint256) {
        uint256 last = lastClaimTime[token][user];
        if (last == 0) return 0;
        uint256 nextClaimAt = last + CLAIM_COOLDOWN;
        if (block.timestamp >= nextClaimAt) return 0;
        return nextClaimAt - block.timestamp;
    }

    function reserveOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @notice Owner can pull reserves back out (rebalancing, winding down).
    function withdrawReserve(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
        emit ReserveWithdrawn(token, amount, to);
    }
}
