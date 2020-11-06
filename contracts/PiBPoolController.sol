
pragma solidity 0.6.12;

import "./PiBPoolAbstractController.sol";
import "./WrappedPiErc20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract PiBPoolController is PiBPoolAbstractController {

    event ReplacePoolTokenWithWrapped(
        address indexed existingToken,
        address indexed wrappedToken,
        address indexed router,
        uint256 balance,
        uint256 denormalizedWeight,
        string name,
        string symbol
    );

    event ReplacePoolTokenWithNewVersion(
        address indexed oldToken,
        address indexed newToken,
        address indexed migrator,
        uint256 balance,
        uint256 denormalizedWeight
    );

    constructor(address _bpool) public PiBPoolAbstractController(_bpool) {

    }

    function replacePoolTokenWithWrapped(
        address _token,
        address _router,
        string calldata _name,
        string calldata _symbol
    )
        external
        onlyOwner
    {
        WrappedPiErc20 wrappedToken = new WrappedPiErc20(_token, _router, _name, _symbol);
        uint256 denormalizedWeight = bpool.getDenormalizedWeight(_token);
        uint256 balance = bpool.getBalance(_token);

        bpool.unbind(_token);

        IERC20(_token).approve(address(wrappedToken), balance);
        wrappedToken.deposit(balance);

        wrappedToken.approve(address(bpool), balance);
        bpool.bind(address(wrappedToken), balance, denormalizedWeight);

        emit ReplacePoolTokenWithWrapped(_token, address(wrappedToken), _router, balance, denormalizedWeight, _name, _symbol);
    }

    function replacePoolTokenWithNewVersion(
        address _oldToken,
        address _newToken,
        address _migrator,
        bytes calldata _migratorData
    )
        external
        onlyOwner
    {
        uint256 denormalizedWeight = bpool.getDenormalizedWeight(_oldToken);
        uint256 balance = bpool.getBalance(_oldToken);

        bpool.unbind(_oldToken);

        IERC20(_oldToken).approve(_migrator, balance);
        (bool success, bytes memory data) = _migrator.call(_migratorData);
        require(success, "NOT_SUCCESS");

        require(
            IERC20(_newToken).balanceOf(address(this)) >= balance,
            "PiBPoolController:newVersion: insufficient newToken balance"
        );

        IERC20(_newToken).approve(address(bpool), balance);
        bpool.bind(_newToken, balance, denormalizedWeight);

        emit ReplacePoolTokenWithNewVersion(_oldToken, _newToken, _migrator, balance, denormalizedWeight);
    }
}
