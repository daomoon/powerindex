// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface WrappedPiErc20Interface is IERC20 {
  function deposit(uint256 _amount) external payable returns (uint256);

  function withdraw(uint256 _amount) external payable returns (uint256);

  function changeRouter(address _newRouter) external;

  function setEthFee(uint256 _newEthFee) external;

  function withdrawEthFee(address payable receiver) external;

  function approveUnderlying(address _to, uint256 _amount) external;

  function callExternal(
    address voting,
    bytes4 signature,
    bytes calldata args,
    uint256 value
  ) external;

  struct ExternalCallData {
    address destination;
    bytes4 signature;
    bytes args;
    uint256 value;
  }

  function callExternalMultiple(ExternalCallData[] calldata calls) external;

  function getUnderlyingBalance() external view returns (uint256);
}
