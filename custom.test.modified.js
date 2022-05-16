const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils } = ethers

const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { encodeDataForBridge } = require('./utils')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
const MINIMUM_WITHDRAWAL_AMOUNT = utils.parseEther(process.env.MINIMUM_WITHDRAWAL_AMOUNT || '0.05')
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(process.env.MAXIMUM_DEPOSIT_AMOUNT || '1')

describe('Custom Tests', function () {
  this.timeout(20000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const [sender, gov, l1Unwrapper, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')

    const token = await deploy('PermittableToken', 'Wrapped ETH', 'WETH', 18, l1ChainId)
    await token.mint(sender.address, utils.parseEther('10000'))

    const amb = await deploy('MockAMB', gov.address, l1ChainId)
    const omniBridge = await deploy('MockOmniBridge', amb.address)

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      'TornadoPool',
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address,
    )

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(
      MINIMUM_WITHDRAWAL_AMOUNT,
      MAXIMUM_DEPOSIT_AMOUNT,
    )
    const proxy = await deploy(
      'CrossChainUpgradeableProxy',
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId,
    )

    const tornadoPool = tornadoPoolImpl.attach(proxy.address)

    await token.approve(tornadoPool.address, utils.parseEther('10000'))

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig }
  }

  async function getAmount(keypair, tornadoPool) {
    const filter = tornadoPool.filters.NewCommitment()
    const fromBlock = await ethers.provider.getBlock()
    const events = await tornadoPool.queryFilter(filter, fromBlock.number)

    let utxo
    try {
      utxo = Utxo.decrypt(keypair, events[0].args.encryptedOutput, events[0].args.index)
    } catch (e) {
      utxo = Utxo.decrypt(keypair, events[1].args.encryptedOutput, events[1].args.index)
    }

    return utxo.amount
  }

  async function depositInL1(keypair, depositAmount, tornadoPool, token, omniBridge) {
    const depositUtxo = new Utxo({ amount: depositAmount, keypair: keypair })
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [depositUtxo],
    })
    const onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    })
    const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      depositUtxo.amount,
      onTokenBridgedData,
    )
    await token.transfer(omniBridge.address, depositAmount)
    const transferTx = await token.populateTransaction.transfer(tornadoPool.address, depositAmount)

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data },
      { who: tornadoPool.address, callData: onTokenBridgedTx.data },
    ])

    return depositUtxo
  }

  it('[assignment] ii. deposit 0.1 ETH in L1 -> withdraw 0.08 ETH in L2 -> assert balances', async () => {
    // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture)
    const keypair = new Keypair()
    // Alice deposits 0.1 ETH in L1
    const depositAmount = utils.parseEther('0.1')

    const depositUtxo = await depositInL1(keypair, depositAmount, tornadoPool, token, omniBridge)

    // Alice withdraws 0.08 ETH in L2
    const withdrawAmount = utils.parseEther('0.08')
    const recipient = '0xDeaD00000000000000000000000000000000BEEf'
    const remainingAmount = depositAmount.sub(withdrawAmount)
    const changeUtxo = new Utxo({
      amount: remainingAmount,
      keypair: keypair,
    })
    await transaction({
      tornadoPool,
      inputs: [depositUtxo],
      outputs: [changeUtxo],
      recipient: recipient,
      isL1Withdrawal: false,
    })

    const expectedAmount = await getAmount(keypair, tornadoPool)
    expect(remainingAmount).to.be.equal(expectedAmount)

    const omniBridgeBalance = await token.balanceOf(omniBridge.address)
    expect(omniBridgeBalance).to.be.equal(0)

    const recipientBalance = await token.balanceOf(recipient)
    expect(recipientBalance).to.be.equal(withdrawAmount)
  })

  it('[assignment] iii. see assignment doc for details', async () => {
    // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture)
    // Alice deposits  0.13 ETH in L1
    const aliceKeypair = new Keypair()
    const aliceDepositAmount = utils.parseEther('0.13')
    const aliceDepositUtxo = await depositInL1(
      aliceKeypair,
      aliceDepositAmount,
      tornadoPool,
      token,
      omniBridge,
    )

    const aliceExpectedDeposit = await getAmount(aliceKeypair, tornadoPool)
    expect(aliceExpectedDeposit).to.be.equal(aliceDepositAmount)

    // Alice sends 0.06 ETH to Bob in L2
    const bobKeypair = new Keypair()
    const bobAddress = bobKeypair.address()

    const sendToBobAmount = utils.parseEther('0.06')
    const sendToBobUtxo = new Utxo({ amount: sendToBobAmount, keypair: Keypair.fromString(bobAddress) })
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(sendToBobAmount),
      keypair: aliceDepositUtxo.keypair,
    })
    await transaction({ tornadoPool, inputs: [aliceDepositUtxo], outputs: [sendToBobUtxo, aliceChangeUtxo] })

    const bobExpectedDeposit = await getAmount(bobKeypair, tornadoPool)
    expect(bobExpectedDeposit).to.be.equal(sendToBobAmount)

    const aliceRemainingDeposit = await getAmount(aliceKeypair, tornadoPool)
    expect(aliceRemainingDeposit).to.be.equal(aliceDepositAmount.sub(sendToBobAmount))

    // Bob withdraws all of his funds in L2
    const bobchangeUtxo = new Utxo({ amount: sendToBobAmount, keypair: bobKeypair })
    await transaction({
      tornadoPool,
      outputs: [bobchangeUtxo],
      isL1Withdrawal: false,
    })

    const bobFinalDeposit = await getAmount(bobKeypair, tornadoPool)
    expect(bobFinalDeposit).to.be.equal(sendToBobAmount)

    //  Alice withdraws all her remaining funds in L1
    const aliceWithdrawAmount = aliceDepositAmount.sub(sendToBobAmount)
    const aliceWithdrawUtxo = new Utxo({ amount: aliceWithdrawAmount, keypair: aliceKeypair })
    await transaction({
      tornadoPool,
      inputs: [aliceChangeUtxo],
      outputs: [aliceWithdrawUtxo],
      isL1Withdrawal: true,
    })
    const aliceFinalDeposit = await getAmount(aliceKeypair, tornadoPool)
    expect(aliceFinalDeposit).to.be.equal(aliceWithdrawAmount)

    const omniBridgeBalance = await token.balanceOf(omniBridge.address)
    expect(omniBridgeBalance).to.be.equal(0)
  })
})
