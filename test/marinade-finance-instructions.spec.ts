import { Marinade, MarinadeConfig, MarinadeUtils, Provider, Wallet, web3 } from '../src'
import * as TestWorld from './test-world'
import * as assert from 'assert'
import {PublicKey} from "@solana/web3.js"

const MINIMUM_LAMPORTS_BEFORE_TEST = MarinadeUtils.solToLamports(2.5)

describe.only('Marinade Finance', () => {
  beforeAll(async() => {
    await TestWorld.provideMinimumLamportsBalance(TestWorld.SDK_USER.publicKey, MINIMUM_LAMPORTS_BEFORE_TEST)
  })

  describe('deposit', () => {
    it('deposits SOL', async() => {
      const config = new MarinadeConfig({
        connection: TestWorld.CONNECTION,
        publicKey: TestWorld.SDK_USER.publicKey,
        // fixed devnet proxy state address
        proxyStateAddress: new PublicKey("Jpp29FzyV7rXdVRWFaiE9tBcVCaEMvj16gk87rC3S4z"),
        proxySolMintAddress: new PublicKey("gso1xA56hacfgTHTF4F7wN5r4jbnJsKh99vR595uybA"),
        // set as a constant here but actually a PDA derivable from the proxy state address
        proxySolMintAuthority: new PublicKey("Cqp2UCMz3NpL38tkGFx5u7mW7NFdbadNUNMoFKuKGYVi"),
      })
      const marinade = new Marinade(config)

      const { transaction } = await marinade.deposit(MarinadeUtils.solToLamports(1))
      const transactionSignature = await TestWorld.PROVIDER.send(transaction)
      console.log('Deposit tx:', transactionSignature, transaction.instructions.length)
    })

    it('deposits SOL, only creates ATA when necessary', async() => {
      const newAccount = new web3.Keypair()
      await TestWorld.provideMinimumLamportsBalance(newAccount.publicKey, MarinadeUtils.solToLamports(2.5))

      const provider = new Provider(
        TestWorld.CONNECTION,
        new Wallet(newAccount),
        { commitment: 'finalized' },
      )

      const anotherAccount = web3.Keypair.generate()
      const config = new MarinadeConfig({
        connection: TestWorld.CONNECTION,
        publicKey: newAccount.publicKey,
      })
      const marinade = new Marinade(config)

      const { transaction: tx1 } = await marinade.deposit(MarinadeUtils.solToLamports(1), { mintToOwnerAddress: anotherAccount.publicKey })
      assert.strictEqual(tx1.instructions.length, 2)
      const transactionSignature1 = await provider.send(tx1)
      console.log('Deposit tx1:', transactionSignature1)

      const { transaction: tx2 } = await marinade.deposit(MarinadeUtils.solToLamports(1),{ mintToOwnerAddress: anotherAccount.publicKey })
      assert.strictEqual(tx2.instructions.length, 1)
      const transactionSignature2 = await provider.send(tx2)
      console.log('Deposit tx2:', transactionSignature2)
    })

    it('deposits SOL and get mSOL to another account', async() => {
      const config = new MarinadeConfig({
        connection: TestWorld.CONNECTION,
        publicKey: TestWorld.SDK_USER.publicKey,
      })
      const marinade = new Marinade(config)

      const anotherAccount = web3.Keypair.generate()
      const { transaction } = await marinade.deposit(MarinadeUtils.solToLamports(1), { mintToOwnerAddress: anotherAccount.publicKey })
      const transactionSignature = await TestWorld.PROVIDER.send(transaction)
      console.log('Deposit tx:', transactionSignature)
    })
  })

  describe('liquidUnstake', () => {
    it('unstakes SOL', async() => {
      const config = new MarinadeConfig({
        connection: TestWorld.CONNECTION,
        publicKey: TestWorld.SDK_USER.publicKey,
      })
      const marinade = new Marinade(config)

      const { transaction } = await marinade.liquidUnstake(MarinadeUtils.solToLamports(0.8))
      const transactionSignature = await TestWorld.PROVIDER.send(transaction)
      console.log('Liquid unstake tx:', transactionSignature)
    })
  })

  describe('orderUnstake', () => {
    it('creates a ticket to unstake SOL', async() => {
      const config = new MarinadeConfig({
        connection: TestWorld.CONNECTION,
        publicKey: TestWorld.SDK_USER.publicKey,
      })
      const marinade = new Marinade(config)

      const orderUnstakeLamports = MarinadeUtils.solToLamports(0.8)
      const { transaction, newTicketAccount } = await marinade.orderUnstake(orderUnstakeLamports)
      const transactionSignature = await TestWorld.PROVIDER.send(transaction)
      console.log('Order unstake tx:', transactionSignature)

      const ticketAccounts = await marinade.getDelayedUnstakeTickets(TestWorld.SDK_USER.publicKey)
      assert.strictEqual(ticketAccounts.get(newTicketAccount.publicKey)?.lamportsAmount, orderUnstakeLamports)
    })
  })

  describe.skip('depositStakeAccount', () => {
    it('deposits stake account', async() => {
      console.log('ReferralCode:', TestWorld.REFERRAL_CODE.toBase58())

      const config = new MarinadeConfig({
        connection: TestWorld.CONNECTION,
        publicKey: TestWorld.SDK_USER.publicKey,
      })
      const marinade = new Marinade(config)

      // Make sure stake account still exist, if this test is included
      const { transaction } = await marinade.depositStakeAccount(new web3.PublicKey('AtL1WfGDuyB2NvnqvuMuwJu4QwtiLyAhoczH5ESy7kNZ'))
      const transactionSignature = await TestWorld.PROVIDER.send(transaction)
      console.log('Deposit stake account tx:', transactionSignature)
    })
  })

  describe.skip('liquidateStakeAccount', () => {
    it('liquidates stake account', async() => {
      const config = new MarinadeConfig({
        connection: TestWorld.CONNECTION,
        publicKey: TestWorld.SDK_USER.publicKey,
      })
      const marinade = new Marinade(config)

      // Make sure stake account still exist, if this test is included
      const { transaction } = await marinade.liquidateStakeAccount(new web3.PublicKey('7Pi7ye5SaKMFp1J6W4kygmAYYhotwoRLTk67Z1kcCcv4'))
      const transactionSignature = await TestWorld.PROVIDER.send(transaction)
      console.log('Liquidate stake account tx:', transactionSignature)
    })
  })
})
