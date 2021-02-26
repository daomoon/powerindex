const { constants, time, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, gwei, deployProxied } = require('../helpers/index');
const assert = require('chai').assert;
const MockProxyCall = artifacts.require('MockProxyCall');
const MockERC20 = artifacts.require('MockERC20');
const xCVP = artifacts.require('xCVP');
const MockCVPMaker = artifacts.require('MockCVPMaker');
const MockWETH = artifacts.require('MockWETH');
const MockFastGasOracle = artifacts.require('MockFastGasOracle');
const MockStaking = artifacts.require('MockStaking');
const PowerPoke = artifacts.require('PowerPoke');
const UniswapV2Factory = artifacts.require('MockUniswapV2Factory');
const UniswapV2Pair = artifacts.require('UniswapV2Pair');
const UniswapV2Router022 = artifacts.require('UniswapV2Router022');
const MockOracle = artifacts.require('MockOracle');
const PowerIndexPoolFactory = artifacts.require('PowerIndexPoolFactory');
const ProxyFactory = artifacts.require('ProxyFactory');
const PowerIndexPoolActions = artifacts.require('PowerIndexPoolActions');
const PowerIndexPool = artifacts.require('PowerIndexPool');
const ExchangeProxy = artifacts.require('ExchangeProxy');

MockERC20.numberFormat = 'String';
xCVP.numberFormat = 'String';
MockCVPMaker.numberFormat = 'String';
PowerPoke.numberFormat = 'String';
UniswapV2Router022.numberFormat = 'String';
PowerIndexPool.numberFormat = 'String';
MockWETH.numberFormat = 'String';
MockStaking.numberFormat = 'String';

const ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const { web3 } = MockERC20;

describe('CVPMaker test', () => {
  let deployer, owner, cvpMakerClientOwner, alice, bob, charlie, reporter, slasher;
  let cvp;
  let weth;
  let xCvp;
  let cvpMaker;
  let uniswapFactory;
  let sushiFactory;
  let uniswapRouter;
  let powerPoke;
  let staking;
  let oracle;

  let usdc;
  let uni;
  let comp;
  let dai;

  let makeUniswapPair;
  let makeSushiPair;
  const pokePeriod = 7 * 60 * 60 * 24;

  before(async function() {
    [deployer, owner, cvpMakerClientOwner, alice, bob, charlie, reporter, slasher] = await web3.eth.getAccounts();
    dai = await MockERC20.new('DAI', 'DAI', '18', ether(1e15));
    weth = await MockWETH.new();
    await weth.deposit({ value: ether(1e9) });
  });

  beforeEach(async () => {
    uniswapFactory = await UniswapV2Factory.new(alice);
    uniswapRouter = await UniswapV2Router022.new(uniswapFactory.address, weth.address);

    async function makePair(factory, tokenA, tokenB, balanceA, balanceB) {
      const res = await uniswapFactory.createPairMock2(tokenA.address, tokenB.address);
      const pair = await UniswapV2Pair.at(res.logs[0].args.pair);
      await tokenA.transfer(pair.address, balanceA);
      await tokenB.transfer(pair.address, balanceB);
      await pair.mint(deployer);
      return pair;
    }

    makeSushiPair = async (tokenA, tokenB, balanceA, balanceB) => {
      return makePair(sushiFactory, tokenA, tokenB, balanceA, balanceB);
    };

    makeUniswapPair = async (tokenA, tokenB, balanceA, balanceB) => {
      return makePair(uniswapFactory, tokenA, tokenB, balanceA, balanceB);
    };

    cvp = await MockERC20.new('CVP', 'CVP', '18', ether(1e12));

    oracle = await MockOracle.new();
    const fastGasOracle = await MockFastGasOracle.new(gwei(300 * 1000));
    staking = await deployProxied(
      MockStaking,
      [cvp.address],
      [owner, bob, constants.ZERO_ADDRESS, '0', '0', '60', '60'],
      { proxyAdminOwner: owner }
    );
    powerPoke = await PowerPoke.new(
      cvp.address,
      weth.address,
      fastGasOracle.address,
      uniswapRouter.address,
      staking.address,
    );
    await powerPoke.initialize(deployer, oracle.address);

    xCvp = await xCVP.new(cvp.address);
    cvpMaker = await MockCVPMaker.new(
      cvp.address,
      xCvp.address,
      weth.address,
      uniswapRouter.address,
      constants.ZERO_ADDRESS,
    );
    await cvpMaker.initialize(powerPoke.address, ether(2000));
    await cvpMaker.transferOwnership(owner);

    // DAI-ETH: 1993.998011983982051969
    // CVP-ETH: 598.19940359519461559
    await makeUniswapPair(dai, weth, ether(2e9), ether(1e6), true);
    await makeUniswapPair(cvp, weth, ether(60e7), ether(1e6), true);
    assert.equal(
      (await uniswapRouter.getAmountsOut(ether(1), [weth.address, dai.address]))[1],
      ether('1993.998011983982051969'),
    );
    assert.equal(
      (await uniswapRouter.getAmountsOut(ether(1), [weth.address, cvp.address]))[1],
      ether('598.19940359519461559'),
    );
    assert.equal(
      (await uniswapRouter.getAmountsOut(ether(1), [cvp.address, weth.address, dai.address]))[2],
      ether('3.313363322338438557'),
    );
  });

  it('should initialize upgradeable CVPMaker correctly', async () => {
    const cvpMaker = await deployProxied(
      MockCVPMaker,
      [cvp.address, xCvp.address, weth.address, uniswapRouter.address, constants.ZERO_ADDRESS],
      [powerPoke.address, ether(3000)],
      { proxyAdminOwner: owner },
    );
    assert.equal(await cvpMaker.cvp(), cvp.address);
    assert.equal(await cvpMaker.xcvp(), xCvp.address);
    assert.equal(await cvpMaker.weth(), weth.address);
    assert.equal(await cvpMaker.uniswapRouter(), uniswapRouter.address);
    assert.equal(await cvpMaker.powerPoke(), powerPoke.address);
    assert.equal(await cvpMaker.cvpAmountOut(), ether(3000));
    await expectRevert(cvpMaker.initialize(alice, ether(20)), 'Contract instance has already been initialized');
  });

  it('should deny initialization with 0 cvpAmountOut', async () => {
    const cvpMaker = await MockCVPMaker.new(
      cvp.address,
      xCvp.address,
      weth.address,
      uniswapRouter.address,
      constants.ZERO_ADDRESS,
    );
    await expectRevert(cvpMaker.initialize(powerPoke.address, ether(0)), 'CVP_AMOUNT_OUT_0');
  });

  describe('poker interface', () => {
    let compensationOpts;

    beforeEach(async () => {
      compensationOpts = web3.eth.abi.encodeParameter(
        {
          PokeRewardOptions: {
            to: 'address',
            compensateInETH: 'bool'
          },
        },
        {
          to: reporter,
          compensateInETH: false
        },
      );

      await staking.setSlasher(powerPoke.address, { from: owner });
      await powerPoke.addClient(cvpMaker.address, cvpMakerClientOwner, true, gwei(300), pokePeriod, pokePeriod * 2, { from: deployer });
      await cvp.approve(powerPoke.address, ether(30000), { from: deployer })
      await powerPoke.addCredit(cvpMaker.address, ether(30000), { from: deployer });
      await powerPoke.setBonusPlan(cvpMaker.address, 1,  true, 20, 17520000, 100 * 1000, { from: cvpMakerClientOwner });

      const slasherDeposit = ether(10000);
      const reporterDeposit = ether(20000);
      await powerPoke.setMinimalDeposit(cvpMaker.address, slasherDeposit, { from: cvpMakerClientOwner });

      await cvp.transfer(reporter, reporterDeposit);
      await cvp.approve(staking.address, reporterDeposit, {from: reporter});
      await staking.createUser(reporter, reporter, reporterDeposit, {from: reporter});

      await cvp.transfer(slasher, slasherDeposit);
      await cvp.approve(staking.address, slasherDeposit, {from: slasher});
      await staking.createUser(slasher, slasher, slasherDeposit, {from: slasher});
      await time.increase(60);
      await staking.executeDeposit('1', {from: reporter});
      await staking.executeDeposit('2', {from: slasher});

      await time.increase(pokePeriod);
      await oracle.setPrice(weth.address, ether(1000));
      await oracle.setPrice(cvp.address, ether(1.5));
    });

    describe('from reporter', () => {
      it('should deny poking from a contract', async function() {
        const proxyCall = await MockProxyCall.new();
        await cvp.transfer(alice, ether(30000));
        await cvp.approve(staking.address, ether(30000), {from: alice});
        await staking.createUser(alice, proxyCall.address, ether(30000), {from: alice});
        await time.increase(60);

        const data = cvpMaker.contract.methods.swapFromReporter(3, dai.address, '0x').encodeABI();
        await expectRevert(proxyCall.makeCall(cvpMaker.address, data), 'NOT_EOA');
      });

      it('should allow poking form the reporter', async () => {
        await dai.transfer(cvpMaker.address, ether(8000));

        assert.equal(await dai.balanceOf(cvpMaker.address), ether(8000));
        assert.equal(await cvp.balanceOf(xCvp.address), ether(0));
        await cvpMaker.swapFromReporter(1, dai.address, compensationOpts, { from: reporter });
        assert.equal(await dai.balanceOf(cvpMaker.address), ether('1293.107830738383556106'));
        assert.equal(await cvp.balanceOf(xCvp.address), ether(2000));
      })

      it('should deny poking from non-valid reporter', async () => {
        await dai.transfer(cvpMaker.address, ether(8000));
        await expectRevert(cvpMaker.swapFromReporter(1, dai.address, compensationOpts, { from: alice }), 'INVALID_POKER_KEY');
      })
    })

    describe('from slasher', () => {
      it('should deny poking from a contract', async function() {
        const proxyCall = await MockProxyCall.new();
        await cvp.transfer(alice, ether(15000));
        await cvp.approve(staking.address, ether(15000), {from: alice});
        await staking.createUser(alice, proxyCall.address, ether(15000), {from: alice});
        await time.increase(60);

        const data = cvpMaker.contract.methods.swapFromSlasher(3, dai.address, '0x').encodeABI();
        await expectRevert(proxyCall.makeCall(cvpMaker.address, data), 'NOT_EOA');
      });

      it('should allow poking form the reporter', async () => {
        await dai.transfer(cvpMaker.address, ether(8000));

        assert.equal(await dai.balanceOf(cvpMaker.address), ether(8000));
        assert.equal(await cvp.balanceOf(xCvp.address), ether(0));
        await cvpMaker.swapFromSlasher(2, dai.address, compensationOpts, { from: slasher });
        assert.equal(await dai.balanceOf(cvpMaker.address), ether('1293.107830738383556106'));
        assert.equal(await cvp.balanceOf(xCvp.address), ether(2000));
      })

      it('should deny poking from reporter', async () => {
        await dai.transfer(cvpMaker.address, ether(8000));
        await expectRevert(cvpMaker.swapFromSlasher(1, dai.address, compensationOpts, { from: reporter }), 'IS_HDH');
      })

      it('should deny poking from non-valid reporter', async () => {
        await dai.transfer(cvpMaker.address, ether(8000));
        await expectRevert(cvpMaker.swapFromSlasher(2, dai.address, compensationOpts, { from: alice }), 'INVALID_POKER_KEY');
      })
    })
  });

  // describe('slasher interface');
  describe('swapping', () => {
    describe('unconfigured token', () => {
      describe('with enough balance', () => {
        it('should send CVP directly to the xCVP', async () => {
          await cvp.transfer(xCvp.address, ether(725));
          await cvp.transfer(cvpMaker.address, ether(5000));
          assert.equal(await cvpMaker.estimateCvpAmountOut(cvp.address), ether(5000));
          assert.equal(await cvpMaker.estimateSwapAmountIn(cvp.address), ether(2000));

          assert.equal(await cvp.balanceOf(cvpMaker.address), ether(5000));
          assert.equal(await cvp.balanceOf(xCvp.address), ether(725));

          const res = await cvpMaker.mockSwap(cvp.address);
          expectEvent(res, 'Swap', {
            swapType: '1',
            caller: deployer,
            token: cvp.address,
            amountIn: ether(2000),
            amountOut: ether(2000),
            xcvpCvpBefore: ether(725),
            xcvpCvpAfter: ether(2725),
          });
          assert.equal(await cvp.balanceOf(cvpMaker.address), ether(3000));
          assert.equal(await cvp.balanceOf(xCvp.address), ether(2725));
        });

        it('should swap the token through token->ETH->CVP uniswap pairs', async () => {
          await dai.transfer(cvpMaker.address, ether(8000));
          await cvp.transfer(xCvp.address, ether(725));

          assert.equal(await cvpMaker.estimateCvpAmountOut(dai.address), ether('2385.602600975004141233'));
          assert.equal(await cvpMaker.estimateSwapAmountIn(dai.address), ether('6706.892169261616443894'));

          assert.equal(await cvp.balanceOf(xCvp.address), ether(725));
          assert.equal(await dai.balanceOf(cvpMaker.address), ether(8000));

          const res = await cvpMaker.mockSwap(dai.address);
          expectEvent(res, 'Swap', {
            swapType: '4',
            caller: deployer,
            token: dai.address,
            amountIn: '6706892169261616443894',
            amountOut: ether(2000),
            xcvpCvpBefore: ether(725),
            xcvpCvpAfter: ether(2725),
          });
          assert.equal(await cvp.balanceOf(xCvp.address), ether(2725));
          assert.equal(
            await dai.balanceOf(cvpMaker.address),
            BigInt(ether(8000)) - BigInt(ether('6706.892169261616443894')),
          );
        });

        it('should swap WETH using WETH-CVP uniswap pair', async () => {
          await cvp.transfer(xCvp.address, ether(725));

          await weth.deposit({ value: ether(4) });
          await weth.transfer(cvpMaker.address, ether(4));

          assert.equal(await cvpMaker.estimateCvpAmountOut(weth.address), ether('2392.790457551655283998'));
          assert.equal(await cvpMaker.estimateEthStrategyOut(weth.address), ether('2392.790457551655283998'));
          assert.equal(await cvpMaker.estimateSwapAmountIn(weth.address), ether('3.343374568186039725'));
          assert.equal(await cvpMaker.estimateEthStrategyIn(), ether('3.343374568186039725'));

          assert.equal(await cvp.balanceOf(xCvp.address), ether(725));
          assert.equal(await weth.balanceOf(cvpMaker.address), ether(4));
          const res = await cvpMaker.mockSwap(weth.address);
          expectEvent(res, 'Swap', {
            swapType: '2',
            caller: deployer,
            token: weth.address,
            amountIn: ether('3.343374568186039725'),
            amountOut: ether(2000),
            xcvpCvpBefore: ether(725),
            xcvpCvpAfter: ether(2725),
          });
          assert.equal(await cvp.balanceOf(xCvp.address), ether(2725));
          assert.equal(
            await weth.balanceOf(cvpMaker.address),
            BigInt(ether(4)) - BigInt(ether('3.343374568186039725')),
          );
        });

        it('should wrap ETH into WETH and swap it using WETH-CVP uniswap pair', async () => {
          await cvp.transfer(xCvp.address, ether(725));
          await web3.eth.sendTransaction({ from: alice, to: cvpMaker.address, value: ether(4) });

          assert.equal(await cvpMaker.estimateCvpAmountOut(ETH), ether('2392.790457551655283998'));
          assert.equal(await cvpMaker.estimateEthStrategyOut(ETH), ether('2392.790457551655283998'));
          assert.equal(await cvpMaker.estimateSwapAmountIn(ETH), ether('3.343374568186039725'));
          assert.equal(await cvpMaker.estimateEthStrategyIn(), ether('3.343374568186039725'));

          assert.equal(await web3.eth.getBalance(cvpMaker.address), ether(4));
          assert.equal(await cvp.balanceOf(xCvp.address), ether(725));

          const res = await cvpMaker.mockSwap(ETH);
          expectEvent(res, 'Swap', {
            swapType: '2',
            caller: deployer,
            token: ETH,
            amountIn: ether('3.343374568186039725'),
            amountOut: ether(2000),
            xcvpCvpBefore: ether(725),
            xcvpCvpAfter: ether(2725),
          });

          assert.equal(await cvp.balanceOf(xCvp.address), ether(2725));
          assert.equal(await web3.eth.getBalance(cvpMaker.address), ether(0));
          assert.equal(
            await weth.balanceOf(cvpMaker.address),
            BigInt(ether(4)) - BigInt(ether('3.343374568186039725')),
          );
        });
      });

      describe('with insufficient balance', () => {
        it('should revert if CVP balance is not enough for a swap', async () => {
          await cvp.transfer(cvpMaker.address, ether('1999.999'));
          assert.equal(await cvp.balanceOf(cvpMaker.address), ether('1999.999'));

          assert.equal(await cvpMaker.estimateCvpAmountOut(cvp.address), ether('1999.999'));
          await expectRevert(cvpMaker.mockSwap(cvp.address), 'ERC20: transfer amount exceeds balance');
        });

        it('should revert if non-CVP balance is not enough for a swap', async () => {
          const insufficientAmount = ether('6706');
          await dai.transfer(cvpMaker.address, insufficientAmount);
          assert.equal(await dai.balanceOf(cvpMaker.address), insufficientAmount);

          assert.equal(await cvpMaker.estimateSwapAmountIn(dai.address), ether('6706.892169261616443894'));
          assert.equal(await cvpMaker.estimateCvpAmountOut(dai.address), ether('1999.733956269714881646'));

          await expectRevert(cvpMaker.mockSwap(dai.address), 'TRANSFER_FROM_FAILED');
        });

        it('should revert if  WETH balance is not enough for a swap', async () => {
          await weth.deposit({ value: ether(4) });
          await weth.transfer(cvpMaker.address, ether('3.3'));

          assert.equal(await weth.balanceOf(cvpMaker.address), ether('3.3'));
          assert.equal(await cvpMaker.estimateSwapAmountIn(weth.address), ether('3.343374568186039725'));
          assert.equal(await cvpMaker.estimateEthStrategyOut(weth.address), ether('1974.053505166562651492'));
          assert.equal(await cvpMaker.estimateCvpAmountOut(weth.address), ether('1974.053505166562651492'));

          await expectRevert(cvpMaker.mockSwap(weth.address), 'TRANSFER_FROM_FAILED');
        });

        it('should revert if ETH balance is not enough for a swap', async () => {
          await web3.eth.sendTransaction({ from: alice, to: cvpMaker.address, value: ether('3.3') });

          assert.equal(await web3.eth.getBalance(cvpMaker.address), ether('3.3'));
          assert.equal(await weth.balanceOf(cvpMaker.address), ether(0));

          assert.equal(await cvpMaker.estimateSwapAmountIn(ETH), ether('3.343374568186039725'));
          assert.equal(await cvpMaker.estimateEthStrategyOut(ETH), ether('1974.053505166562651492'));
          assert.equal(await cvpMaker.estimateCvpAmountOut(ETH), ether('1974.053505166562651492'));

          await expectRevert(cvpMaker.mockSwap(ETH), 'TRANSFER_FROM_FAILED');
        });
      });

      describe('with 0 balance', () => {
        it('should revert if CVP balance is 0', async () => {
          assert.equal(await cvp.balanceOf(cvpMaker.address), ether(0));
          assert.equal(await cvpMaker.estimateCvpAmountOut(cvp.address), ether(0));
          await expectRevert(cvpMaker.mockSwap(cvp.address), 'ERC20: transfer amount exceeds balance');
        });

        it('should revert if non-CVP balance is 0', async () => {
          assert.equal(await dai.balanceOf(cvpMaker.address), ether(0));
          assert.equal(await cvpMaker.estimateEthStrategyOut(dai.address), ether(0));
          assert.equal(await cvpMaker.estimateCvpAmountOut(dai.address), ether(0));
          await expectRevert(cvpMaker.mockSwap(dai.address), 'TRANSFER_FROM_FAILED');
        });

        it('should revert if both ETH and WETH balances are 0 for ETH', async () => {
          assert.equal(await web3.eth.getBalance(cvpMaker.address), ether(0));
          assert.equal(await weth.balanceOf(cvpMaker.address), ether(0));
          assert.equal(await cvpMaker.estimateEthStrategyOut(ETH), ether(0));
          assert.equal(await cvpMaker.estimateCvpAmountOut(ETH), ether(0));

          await expectRevert(cvpMaker.mockSwap(ETH), 'ETH_BALANCE_IS_0');
        });

        it('should revert if  WETH balance is 0 for ETH', async () => {
          assert.equal(await weth.balanceOf(cvpMaker.address), ether(0));
          assert.equal(await cvpMaker.estimateEthStrategyOut(weth.address), ether(0));
          assert.equal(await cvpMaker.estimateCvpAmountOut(weth.address), ether(0));

          await expectRevert(cvpMaker.mockSwap(weth.address), 'TRANSFER_FROM_FAILED');
        });
      });
    });

    describe('token with custom settings', () => {
      let sushiRouter;
      let sushi;

      beforeEach(async () => {
        uni = await MockERC20.new('UNI', 'UNI', '18', ether(1e15));
        usdc = await MockERC20.new('USDC', 'USDC', '6', ether(1e15));
        sushiFactory = await UniswapV2Factory.new(alice);
        sushiRouter = await UniswapV2Router022.new(uniswapFactory.address, weth.address);
        sushi = await MockERC20.new('SUSHI', 'SUSHI', '18', ether(1e15));
      });

      describe('using a custom uniswap path', async () => {
        beforeEach(async () => {
          // UNI->USDC->DAI->WETH->CVP
          // UNI-USDC: 24.924993787445298479
          // DAI->USDC: 0.996999999502995500
          await makeUniswapPair(uni, usdc, ether(4e6), ether(1e8), true);
          await makeUniswapPair(usdc, dai, ether(2e9), ether(2e9), true);
          assert.equal(
            (await uniswapRouter.getAmountsOut(ether(1), [uni.address, usdc.address]))[1],
            ether('24.924993787445298479'),
          );
          assert.equal(
            (await uniswapRouter.getAmountsOut(ether(1), [uni.address, usdc.address, dai.address]))[2],
            ether('24.850218497316279064'),
          );

          await cvpMaker.setCustomPath(
            uni.address,
            uniswapRouter.address,
            [uni.address, usdc.address, dai.address, weth.address, cvp.address],
            { from: owner },
          );
          await cvp.transfer(xCvp.address, ether(725));
        });

        it('should swap if the balance is enough', async () => {
          await uni.transfer(cvpMaker.address, ether(500));
          // INs
          assert.equal(await cvpMaker.estimateEthStrategyIn(), ether('3.343374568186039725'));
          assert.equal(await cvpMaker.estimateUniLikeStrategyIn(uni.address), ether('269.911675708212223606'));
          assert.equal(
            (
              await uniswapRouter.getAmountsIn(ether('3.343374568186039725'), [
                uni.address,
                usdc.address,
                dai.address,
                weth.address,
              ])
            )[0],
            ether('269.911675708212223606'),
          );

          // OUTs
          assert.equal(await cvpMaker.estimateCvpAmountOut(uni.address), ether('3704.671561101249231727'));
          assert.equal(await cvpMaker.estimateUniLikeStrategyOut(uni.address), ether('3704.671561101249231727'));
          assert.equal(
            (
              await uniswapRouter.getAmountsOut(ether(500), [
                uni.address,
                usdc.address,
                dai.address,
                weth.address,
                cvp.address,
              ])
            )[4],
            ether('3704.671561101249231727'),
          );

          assert.equal(await uni.balanceOf(cvpMaker.address), ether(500));
          assert.equal(await cvp.balanceOf(xCvp.address), ether(725));
          const res = await cvpMaker.mockSwap(uni.address);
          expectEvent(res, 'Swap', {
            swapType: '4',
            caller: deployer,
            token: uni.address,
            amountIn: ether('269.911675708212223606'),
            amountOut: ether(2000),
            xcvpCvpBefore: ether(725),
            xcvpCvpAfter: ether(2725),
          });
          assert.equal(await cvp.balanceOf(xCvp.address), ether(2725));
          assert.equal(
            await uni.balanceOf(cvpMaker.address),
            (BigInt(ether(500)) - BigInt(ether('269.911675708212223606'))).toString(),
          );
        });

        it('should revert if the balance is not enough', async () => {
          await uni.transfer(cvpMaker.address, ether(269));
          assert.equal(await uni.balanceOf(cvpMaker.address), ether(269));

          assert.equal(await cvpMaker.estimateCvpAmountOut(uni.address), ether('1993.245157172728270489'));
          assert.equal(await cvpMaker.estimateUniLikeStrategyIn(uni.address), ether('269.911675708212223606'));

          await expectRevert(cvpMaker.mockSwap(uni.address), 'TRANSFER_FROM_FAILED');
        });

        it('should revert if the balance is 0', async () => {
          assert.equal(await uni.balanceOf(cvpMaker.address), ether(0));

          assert.equal(await cvpMaker.estimateCvpAmountOut(uni.address), ether(0));
          assert.equal(await cvpMaker.estimateUniLikeStrategyIn(uni.address), ether('269.911675708212223606'));

          await expectRevert(cvpMaker.mockSwap(uni.address), 'TRANSFER_FROM_FAILED');
        });
      });

      describe('with a custom non-uniswap path', () => {
        beforeEach(async () => {
          // SUSHI->WETH@Sushi && WETH->CVP@Uni
          // SUSHI-WETH: 14.242855114267635867
          await makeSushiPair(sushi, weth, ether(1.5e8), ether(1e6), true);
          assert.equal(
            (await sushiRouter.getAmountsOut(ether(1), [sushi.address, weth.address]))[1],
            ether('0.006646666622488489'),
          );

          await cvpMaker.setCustomPath(sushi.address, sushiRouter.address, [sushi.address, weth.address], {
            from: owner,
          });

          await cvp.transfer(xCvp.address, ether(725));
        });

        it('should use a custom non-Uniswap path if the one is set', async () => {
          await sushi.transfer(cvpMaker.address, ether(600));
          assert.equal(await cvpMaker.estimateCvpAmountOut(sushi.address), ether('2385.602600975004141233'));

          // INs
          assert.equal(await cvpMaker.estimateEthStrategyIn(), ether('3.343374568186039725'));
          assert.equal(await cvpMaker.estimateUniLikeStrategyIn(sushi.address), ether('503.016912694621233293'));
          assert.equal(
            (await sushiRouter.getAmountsIn(ether('3.343374568186039725'), [sushi.address, weth.address]))[0],
            ether('503.016912694621233293'),
          );

          // OUTs
          assert.equal(await cvpMaker.estimateCvpAmountOut(sushi.address), ether('2385.602600975004141233'));
          assert.equal(await cvpMaker.estimateUniLikeStrategyOut(sushi.address), ether('2385.602600975004141233'));
          assert.equal(
            (await sushiRouter.getAmountsOut(ether('503.016912694621233293'), [sushi.address, weth.address]))[1],
            ether('3.343374568186039725'),
          );

          assert.equal(await sushi.balanceOf(cvpMaker.address), ether(600));
          assert.equal(await cvp.balanceOf(xCvp.address), ether(725));
          const res = await cvpMaker.mockSwap(sushi.address);
          expectEvent(res, 'Swap', {
            swapType: '4',
            caller: deployer,
            token: sushi.address,
            amountIn: ether('503.016912694621233293'),
            amountOut: ether(2000),
            xcvpCvpBefore: ether(725),
            xcvpCvpAfter: ether(2725),
          });
          assert.equal(await cvp.balanceOf(xCvp.address), ether(2725));
          assert.equal(
            await sushi.balanceOf(cvpMaker.address),
            (BigInt(ether(600)) - BigInt(ether('503.016912694621233293'))).toString(),
          );
        });

        it('should revert if the balance is not enough', async () => {
          await sushi.transfer(cvpMaker.address, ether(503));
          assert.equal(await sushi.balanceOf(cvpMaker.address), ether(503));

          assert.equal(await cvpMaker.estimateCvpAmountOut(sushi.address), ether('1999.932755415266269483'));
          assert.equal(await cvpMaker.estimateUniLikeStrategyIn(sushi.address), ether('503.016912694621233293'));

          await expectRevert(cvpMaker.mockSwap(sushi.address), 'TRANSFER_FROM_FAILED');
        });

        it('should revert if the balance is 0', async () => {
          assert.equal(await sushi.balanceOf(cvpMaker.address), ether(0));

          assert.equal(await cvpMaker.estimateCvpAmountOut(sushi.address), ether(0));
          assert.equal(await cvpMaker.estimateUniLikeStrategyIn(sushi.address), ether('503.016912694621233293'));

          await expectRevert(cvpMaker.mockSwap(sushi.address), 'TRANSFER_FROM_FAILED');
        });
      });
    });

    describe('bpool strategires', () => {
      async function getTimestamp(shift = 0) {
        const currentTimestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
        return currentTimestamp + shift;
      }

      async function buildBPool(tokens_, balances, weights) {
        const [first, second, third] = tokens_;
        const name = 'My Pool';
        const symbol = 'MP';
        const swapFee = ether('0.01').toString();
        const communitySwapFee = ether('0.05').toString();
        const communityJoinFee = ether('0.04').toString();
        const communityExitFee = ether('0.07').toString();
        const minWeightPerSecond = ether('0.00000001').toString();
        const maxWeightPerSecond = ether('0.1').toString();

        const proxyFactory = await ProxyFactory.new();
        const impl = await PowerIndexPool.new();
        this.bFactory = await PowerIndexPoolFactory.new(proxyFactory.address, impl.address, constants.ZERO_ADDRESS, {
          from: deployer,
        });
        this.bActions = await PowerIndexPoolActions.new({ from: deployer });
        this.bExchange = await ExchangeProxy.new(weth.address, { from: deployer });

        const tokens = [first.address, second.address, third.address];

        await first.approve(this.bActions.address, balances[0]);
        await second.approve(this.bActions.address, balances[1]);
        await third.approve(this.bActions.address, balances[2]);

        const fromTimestamps = [await getTimestamp(100), await getTimestamp(100), await getTimestamp(100)].map(w =>
          w.toString(),
        );
        const targetTimestamps = [
          await getTimestamp(10000),
          await getTimestamp(10000),
          await getTimestamp(10000),
        ].map(w => w.toString());

        let res = await this.bActions.create(
          this.bFactory.address,
          name,
          symbol,
          {
            minWeightPerSecond,
            maxWeightPerSecond,
            swapFee,
            communitySwapFee,
            communityJoinFee,
            communityExitFee,
            communityFeeReceiver: deployer,
            finalize: true,
          },
          tokens.map((t, i) => ({
            token: t,
            balance: balances[i].toString(),
            targetDenorm: weights[i].toString(),
            fromTimestamp: fromTimestamps[i].toString(),
            targetTimestamp: targetTimestamps[i].toString(),
          })),
        );

        const logNewPool = PowerIndexPoolFactory.decodeLogs(res.receipt.rawLogs).filter(
          l => l.event === 'LOG_NEW_POOL',
        )[0];
        await time.increase(11000);
        return await PowerIndexPool.at(logNewPool.args.pool);
      }

      let bpool;
      describe('strategy1 token (including CVP)', () => {
        beforeEach(async () => {
          uni = await MockERC20.new('UNI', 'UNI', '18', ether(1e15));
          comp = await MockERC20.new('COMP', 'COMP', '18', ether(1e15));
          const balances = [ether(25e6), ether(15e6), ether(10e6)];
          const weights = [ether(25), ether(15), ether(10)];
          bpool = await buildBPool([uni, comp, cvp], balances, weights);

          await cvpMaker.setCustomStrategy(bpool.address, 1, { from: owner });
        });

        it('should swap if there is enough assets', async () => {
          await bpool.transfer(cvpMaker.address, ether(5));

          assert.equal(await cvpMaker.cvpAmountOut(), ether(2000));

          // In
          assert.equal(
            await cvpMaker.bPoolGetExitAmountIn(bpool.address, cvp.address, ether(2000)),
            ether('0.0040325832859546'),
          );
          assert.equal(await cvpMaker.estimateStrategy1In(bpool.address), ether('0.0040325832859546'));

          // Out
          assert.equal(await cvpMaker.bPoolGetExitAmountOut(bpool.address, cvp.address, ether(5)), ether('2244093.1'));
          assert.equal(await cvpMaker.estimateStrategy1Out(bpool.address), ether('2244093.1'));

          assert.equal(await cvp.balanceOf(xCvp.address), ether(0));
          assert.equal(await bpool.balanceOf(cvpMaker.address), ether(5));

          await cvpMaker.mockSwap(bpool.address);

          assert.equal(await cvp.balanceOf(xCvp.address), ether(2000));
          assert.equal(await bpool.balanceOf(cvpMaker.address), ether('4.995663862614869500'));
        });

        it('should revert if the balance is not enough', async () => {
          await bpool.transfer(cvpMaker.address, ether('0.00403'));
          assert.equal(await bpool.balanceOf(cvpMaker.address), ether('0.00403'));

          assert.equal(await cvpMaker.estimateCvpAmountOut(bpool.address), ether('1998.718896764590400000'));
          assert.equal(await cvpMaker.estimateSwapAmountIn(bpool.address), ether('0.004032583285954600'));

          await expectRevert(cvpMaker.mockSwap(bpool.address), 'ERR_INSUFFICIENT_BAL');
        });

        it('should revert if the balance is 0', async () => {
          assert.equal(await bpool.balanceOf(cvpMaker.address), ether(0));

          assert.equal(await cvpMaker.estimateCvpAmountOut(bpool.address), ether(0));
          assert.equal(await cvpMaker.estimateSwapAmountIn(bpool.address), ether('0.004032583285954600'));

          await expectRevert(cvpMaker.mockSwap(bpool.address), 'ERR_INSUFFICIENT_BAL');
        });
      });

      describe('strategy2 token (without CVP)', () => {
        let aave;
        let sushi;
        let snx;
        let bpool;

        beforeEach(async () => {
          aave = await MockERC20.new('AAVE', 'AAVE', '18', ether(1e15));
          sushi = await MockERC20.new('SUSHI', 'SUSHI', '18', ether(1e15));
          snx = await MockERC20.new('SNX', 'SNX', '18', ether(1e15));

          // CVP-ETH: 598.19940359519461559
          // AAVE-DAI: 4.984995029959955129
          // SUSHI-DAI: 14.242855114267635867
          // SNX-DAI: 19.880179604183832888
          await makeUniswapPair(aave, weth, ether(5e6), ether(1e6), true);
          await makeSushiPair(sushi, weth, ether(1.5e8), ether(1e6), true);
          await makeUniswapPair(snx, weth, ether(1e8), ether(1e6), true);
          assert.equal(
            (await uniswapRouter.getAmountsOut(ether(1), [snx.address, weth.address, dai.address]))[2],
            ether('19.880179604183832888'),
          );

          bpool = await buildBPool(
            [aave, sushi, snx],
            [ether(12500), ether(2e5), ether(1e5)],
            [ether(25), ether(15), ether(10)],
          );

          await cvpMaker.setCustomStrategy(bpool.address, 2, { from: owner });
        });

        it('should use the strategy2 when configured', async () => {
          await cvpMaker.syncStrategy2Tokens(bpool.address, { from: alice });
          await bpool.transfer(cvpMaker.address, ether(10));

          assert.sameMembers(await cvpMaker.getStrategy2Tokens(bpool.address), [
            aave.address,
            sushi.address,
            snx.address,
          ]);
          assert.equal(await cvpMaker.getStrategy2NextIndex(bpool.address), ether(0));
          assert.equal(await cvpMaker.getStrategy2NextTokenToExit(bpool.address), aave.address);

          // >>> Amounts IN
          // Out CVP / In (AAVE w/o fee)
          assert.equal(
            (await uniswapRouter.getAmountsIn(ether(2000), [aave.address, weth.address, cvp.address]))[0],
            ether('16.767230423154041110'),
          );
          // Out AAVE / In (bPool)
          assert.equal(
            await cvpMaker.bPoolGetExitAmountIn(bpool.address, aave.address, ether('18.029280024896818398')),
            ether('0.0725058031454588'),
          );
          // Out CVP / In (bPool)
          assert.equal(await cvpMaker.estimateStrategy2In(bpool.address), ether('0.0725058031454588'));
          // Out CVP / In (bPool)
          assert.equal(await cvpMaker.estimateSwapAmountIn(bpool.address), ether('0.0725058031454588'));

          // >>> Amounts OUT
          // In bPool / Out (AAVE)
          assert.equal(await cvpMaker.bPoolGetExitAmountOut(bpool.address, aave.address, ether(10)), ether('2363.125'));
          // In AAVE / Out (CVP)
          assert.equal(
            (await uniswapRouter.getAmountsOut(ether('23.63125'), [aave.address, weth.address, cvp.address]))[2],
            ether('2818.734497440659813346'),
          );
          // In bPool / Out (CVP)
          assert.equal(await cvpMaker.estimateStrategy2Out(bpool.address), ether('261915.564701491379018883'));
          // In bPool / Out (CVP)
          assert.equal(await cvpMaker.estimateCvpAmountOut(bpool.address), ether('261915.564701491379018883'));

          assert.equal(await cvp.balanceOf(xCvp.address), ether(0));
          assert.equal(await bpool.balanceOf(cvpMaker.address), ether(10));

          await cvpMaker.mockSwap(bpool.address);

          assert.equal(await cvp.balanceOf(xCvp.address), ether(2000));
          const expectedBPoolLeftover = (BigInt(ether(10)) - BigInt(ether('0.0725058031454588'))).toString();
          assert.equal(expectedBPoolLeftover, ether('9.927494196854541200'));
          assert.equal(await bpool.balanceOf(cvpMaker.address), expectedBPoolLeftover);
        });

        it('should iterate over the tokens after an each swap', async () => {
          await cvpMaker.syncStrategy2Tokens(bpool.address, { from: alice });

          await bpool.transfer(cvpMaker.address, ether(100));

          // initial swap
          assert.equal(await cvpMaker.estimateStrategy2In(bpool.address), ether('0.0725058031454588'));
          assert.equal(await cvpMaker.getStrategy2NextIndex(bpool.address), ether(0));
          assert.equal(await cvpMaker.getStrategy2NextTokenToExit(bpool.address), aave.address);
          await cvpMaker.mockSwap(bpool.address);

          // second swap
          assert.equal(await cvpMaker.estimateStrategy2In(bpool.address), ether('0.081722936763776726'));
          assert.equal(await cvpMaker.getStrategy2NextIndex(bpool.address), '1');
          assert.equal(await cvpMaker.getStrategy2NextTokenToExit(bpool.address), sushi.address);
          await cvpMaker.mockSwap(bpool.address);

          // third swap
          assert.equal(await cvpMaker.estimateStrategy2In(bpool.address), ether('0.072693329380864298'));
          assert.equal(await cvpMaker.getStrategy2NextIndex(bpool.address), '2');
          assert.equal(await cvpMaker.getStrategy2NextTokenToExit(bpool.address), snx.address);
          await cvpMaker.mockSwap(bpool.address);

          // fourth swap
          assert.equal(await cvpMaker.estimateStrategy2In(bpool.address), ether('0.072447738033226438'));
          assert.equal(await cvpMaker.getStrategy2NextIndex(bpool.address), '0');
          assert.equal(await cvpMaker.getStrategy2NextTokenToExit(bpool.address), aave.address);
          await cvpMaker.mockSwap(bpool.address);

          // fifth swap
          assert.equal(await cvpMaker.estimateStrategy2In(bpool.address), ether('0.081760909948550247'));
          assert.equal(await cvpMaker.getStrategy2NextIndex(bpool.address), '1');
          assert.equal(await cvpMaker.getStrategy2NextTokenToExit(bpool.address), sushi.address);
          await cvpMaker.mockSwap(bpool.address);

          // expected the sixth swap, but unbind instead
          assert.equal(await cvpMaker.estimateStrategy2In(bpool.address), ether('0.072792940476284364'));
          assert.equal(await cvpMaker.getStrategy2NextIndex(bpool.address), '2');
          assert.equal(await cvpMaker.getStrategy2NextTokenToExit(bpool.address), snx.address);
          await bpool.unbind(snx.address);
          await cvpMaker.syncStrategy2Tokens(bpool.address, { from: alice });
          assert.equal(await cvpMaker.estimateStrategy2In(bpool.address), ether('0.090430495162160678'));
          assert.equal(await cvpMaker.getStrategy2NextIndex(bpool.address), '0');
          assert.equal(await cvpMaker.getStrategy2NextTokenToExit(bpool.address), aave.address);
          await cvpMaker.mockSwap(bpool.address);

          assert.equal(await cvpMaker.estimateStrategy2In(bpool.address), ether('0.102216584492803626'));
          assert.equal(await cvpMaker.getStrategy2NextIndex(bpool.address), '1');
          assert.equal(await cvpMaker.getStrategy2NextTokenToExit(bpool.address), sushi.address);
          await cvpMaker.mockSwap(bpool.address);

          assert.equal(await cvpMaker.estimateStrategy2In(bpool.address), ether('0.090388216833249222'));
          assert.equal(await cvpMaker.getStrategy2NextIndex(bpool.address), '0');
          assert.equal(await cvpMaker.getStrategy2NextTokenToExit(bpool.address), aave.address);
        });

        it('should revert if the balance is not enough', async () => {
          await cvpMaker.syncStrategy2Tokens(bpool.address, { from: alice });
          await bpool.transfer(cvpMaker.address, ether('0.072'));
          assert.equal(await bpool.balanceOf(cvpMaker.address), ether('0.072'));

          assert.equal(await cvpMaker.estimateCvpAmountOut(bpool.address), ether('1986.053043590001535860'));
          assert.equal(await cvpMaker.estimateSwapAmountIn(bpool.address), ether('0.0725058031454588'));

          await expectRevert(cvpMaker.mockSwap(bpool.address), 'ERR_INSUFFICIENT_BAL');
        });

        it('should revert if the balance is 0', async () => {
          await cvpMaker.syncStrategy2Tokens(bpool.address, { from: alice });
          assert.equal(await bpool.balanceOf(cvpMaker.address), ether(0));

          assert.equal(await cvpMaker.estimateCvpAmountOut(bpool.address), ether(0));
          assert.equal(await cvpMaker.estimateSwapAmountIn(bpool.address), ether('0.0725058031454588'));

          await expectRevert(cvpMaker.mockSwap(bpool.address), 'ERR_INSUFFICIENT_BAL');
        });
      });
    });
  });

  describe('owner interface', () => {
    describe('setCvpAmountOut()', () => {
      it('should allow the owner changing the value', async () => {
        await cvpMaker.setCvpAmountOut(123, { from: owner });
        assert.equal(await cvpMaker.cvpAmountOut(), 123);
      });

      it('should deny setting 0 amount', async () => {
        await expectRevert(cvpMaker.setCvpAmountOut(0, { from: owner }), 'CVP_AMOUNT_OUT_0');
      });

      it('should deny calling from non-owner', async () => {
        await expectRevert(cvpMaker.setCvpAmountOut(123, { from: alice }), 'Ownable: caller is not the owner');
      });
    });

    describe('setCustomStrategy()', () => {
      it('should allow the owner changing the value', async () => {
        await cvpMaker.setCustomStrategy(alice, 1, { from: owner });
        await cvpMaker.setCustomStrategy(bob, 12, { from: owner });
        await cvpMaker.setCustomStrategy(charlie, 0, { from: owner });
        assert.equal(await cvpMaker.customStrategies(alice), 1);
        assert.equal(await cvpMaker.customStrategies(bob), 12);
        assert.equal(await cvpMaker.customStrategies(charlie), 0);
      });

      it('should deny calling from non-owner', async () => {
        await expectRevert(cvpMaker.setCustomStrategy(bob, 123, { from: alice }), 'Ownable: caller is not the owner');
      });
    });

    describe('setCustomPath()', () => {
      it('should allow the owner changing the value', async () => {
        await cvpMaker.setCustomPath(dai.address, alice, [bob, charlie, weth.address], { from: owner });
        assert.equal(await cvpMaker.routers(dai.address), alice);
        assert.equal(await cvpMaker.getRouter(dai.address), alice);
        assert.sameMembers(await cvpMaker.getPath(dai.address), [bob, charlie, weth.address]);
      });

      it('should deny setting non-CVP ending path for the uniswap router', async () => {
        await expectRevert(
          cvpMaker.setCustomPath(dai.address, uniswapRouter.address, [bob, charlie, weth.address], { from: owner }),
          'NON_CVP_END_ON_UNISWAP_PATH',
        );
      });

      it('should deny setting non-WETH ending path for a non-uniswap router', async () => {
        await expectRevert(
          cvpMaker.setCustomPath(dai.address, alice, [bob, charlie, cvp.address], { from: owner }),
          'NON_WETH_END_ON_NON_UNISWAP_PATH',
        );
      });

      it('should deny calling from non-owner', async () => {
        await expectRevert(
          cvpMaker.setCustomPath(dai.address, alice, [bob, charlie, weth.address], { from: alice }),
          'Ownable: caller is not the owner',
        );
      });
    });
  });
});