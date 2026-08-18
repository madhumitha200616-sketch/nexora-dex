// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @notice Fixed-rate exchange for Nexora's custom tokens (Nova, Fusion,
/// Vertex, Orbit). Unlike a Uniswap pool, the rate here is set directly by
/// the owner (USD price per whole token) and never moves with trade size -
/// every swap fills at exactly that rate, 0% price impact, limited only by
/// how much of the output token this contract currently holds. Reserves are
/// just this contract's plain token balances - top up with a normal ERC20
/// transfer, no special "deposit" call needed.
contract NexoraFixedRateExchange is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // USD price of 1 WHOLE token, scaled by 1e18 (e.g. $10,000 -> 10000e18).
    mapping(address => uint256) public priceUsd18;
    mapping(address => uint8) private _decimalsOf;

    event PriceSet(address indexed token, uint256 priceUsd18);
    event Swap(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    event ReserveWithdrawn(address indexed token, uint256 amount, address indexed to);

    error TokenNotSupported(address token);
    error InsufficientReserve(address token, uint256 needed, uint256 available);
    error SlippageExceeded(uint256 amountOut, uint256 minAmountOut);
    error SameToken();
    error ZeroAmount();
    error InvalidRecipient();

    constructor(address[] memory tokens, uint256[] memory prices18) {
        require(tokens.length == prices18.length, "length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            _setPrice(tokens[i], prices18[i]);
        }
    }

    function setPrice(address token, uint256 newPriceUsd18) external onlyOwner {
        _setPrice(token, newPriceUsd18);
    }

    function _setPrice(address token, uint256 newPriceUsd18) internal {
        require(newPriceUsd18 > 0, "price must be > 0");
        if (_decimalsOf[token] == 0) {
            _decimalsOf[token] = IERC20Metadata(token).decimals();
        }
        priceUsd18[token] = newPriceUsd18;
        emit PriceSet(token, newPriceUsd18);
    }

    /// @notice How much `tokenOut` you'd get for `amountIn` of `tokenIn`, at
    /// the current fixed rate. Pure math, no pool state involved - same
    /// rate for 1 token or 1,000,000.
    function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        uint256 priceIn = priceUsd18[tokenIn];
        uint256 priceOut = priceUsd18[tokenOut];
        if (priceIn == 0) revert TokenNotSupported(tokenIn);
        if (priceOut == 0) revert TokenNotSupported(tokenOut);

        uint256 decimalsIn = _decimalsOf[tokenIn];
        uint256 decimalsOut = _decimalsOf[tokenOut];

        return (amountIn * priceIn * (10 ** decimalsOut)) / ((10 ** decimalsIn) * priceOut);
    }

    /// @notice Swap at the fixed rate, sending the output to `recipient`
    /// (pass msg.sender to keep it yourself). Reverts if this contract
    /// doesn't currently hold enough `tokenOut` to pay out - there's no
    /// partial fill, and no price-impact curve to "absorb" an oversized
    /// trade the way an AMM pool would.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (tokenIn == tokenOut) revert SameToken();
        if (amountIn == 0) revert ZeroAmount();
        if (recipient == address(0)) revert InvalidRecipient();

        amountOut = getAmountOut(tokenIn, tokenOut, amountIn);
        if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);

        uint256 available = IERC20(tokenOut).balanceOf(address(this));
        if (available < amountOut) revert InsufficientReserve(tokenOut, amountOut, available);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);

        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @notice Owner can pull reserves back out (rebalancing, winding down,
    /// recovering funds).
    function withdrawReserve(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
        emit ReserveWithdrawn(token, amount, to);
    }

    function reserveOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
