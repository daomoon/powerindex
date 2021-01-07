// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface PowerIndexWrapperInterface {
  function setPiTokenForUnderlyingsMultiple(address[] calldata _underlyingTokens, address[] calldata _piTokens)
    external;

  function setPiTokenForUnderlying(address _underlyingTokens, address _piToken) external;

  function updatePiTokenEthFees(address[] calldata _underlyingTokens) external;

  function withdrawOddEthFee(address payable _recipient) external;
}
