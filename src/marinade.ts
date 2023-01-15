import { MarinadeConfig } from './config/marinade-config'
import { BN, Provider, utils, Wallet, web3 } from '@project-serum/anchor'
import { MarinadeState } from './marinade-state/marinade-state'
import {
  getAssociatedTokenAccountAddress,
  getOrCreateAssociatedTokenAccount,
  getParsedStakeAccountInfo,
} from './util/anchor'
import { DepositOptions, ErrorMessage, MarinadeResult } from './marinade.types'
import { MarinadeFinanceProgram } from './programs/marinade-finance-program'
import { MarinadeReferralProgram } from './programs/marinade-referral-program'
import { MarinadeReferralPartnerState } from './marinade-referral-state/marinade-referral-partner-state'
import { MarinadeReferralGlobalState } from './marinade-referral-state/marinade-referral-global-state'
import { assertNotNullAndReturn } from './util/assert'
import { TicketAccount } from './marinade-state/borsh/ticket-account'
import { computeMsolAmount, proportionalBN } from './util'
import { PublicKey } from "@solana/web3.js"

export class Marinade {
  constructor(public readonly config: MarinadeConfig = new MarinadeConfig()) { }

  readonly provider: Provider = new Provider(
    this.config.connection,
    new Wallet(web3.Keypair.generate()),
    { commitment: 'confirmed' },
  )

  /**
   * The main Marinade Program
   */
  readonly marinadeFinanceProgram = new MarinadeFinanceProgram(
    this.config.marinadeFinanceProgramId,
    this.config.proxyProgramId,
    this.provider,
  )

  /**
   * The Marinade Program for referral partners
   */
  readonly marinadeReferralProgram = new MarinadeReferralProgram(
    this.config.marinadeReferralProgramId,
    this.provider,
    this.config.referralCode,
    this,
  )

  private deriveTokenAccountAddress(): [PublicKey, number] {
    const seeds = [
      this.config.proxyStateAddress.toBuffer(),
      utils.bytes.utf8.encode("msol_account"),
    ]
    return PublicKey.findProgramAddressSync(
      seeds,
      this.config.proxyProgramId
    )
  }

  private isReferralProgram(): boolean {
    return this.config.referralCode != null
  }

  private provideReferralOrMainProgram(): MarinadeFinanceProgram | MarinadeReferralProgram {
    return this.isReferralProgram() ? this.marinadeReferralProgram : this.marinadeFinanceProgram
  }

  /**
   * Fetch the Marinade's internal state
   */
  async getMarinadeState(): Promise<MarinadeState> {
    return MarinadeState.fetch(this)
  }

  /**
   * Fetch the Marinade referral partner's state
   */
  async getReferralPartnerState(): Promise<MarinadeReferralPartnerState> {
    return MarinadeReferralPartnerState.fetch(this)
  }

  /**
   * Fetch the Marinade referral program's global state
   */
  async getReferralGlobalState(): Promise<MarinadeReferralGlobalState> {
    return MarinadeReferralGlobalState.fetch(this)
  }

  /**
   * Returns a transaction with the instructions to
   * Add liquidity to the liquidity pool and receive LP tokens
   *
   * @param {BN} amountLamports - The amount of lamports added to the liquidity pool
   */
  async addLiquidity(amountLamports: BN): Promise<MarinadeResult.AddLiquidity> {
    const ownerAddress = assertNotNullAndReturn(this.config.publicKey, ErrorMessage.NO_PUBLIC_KEY)
    const marinadeState = await this.getMarinadeState()
    const transaction = new web3.Transaction()

    const {
      associatedTokenAccountAddress: associatedLPTokenAccountAddress,
      createAssociateTokenInstruction,
    } = await getOrCreateAssociatedTokenAccount(this.provider, marinadeState.lpMintAddress, ownerAddress)

    if (createAssociateTokenInstruction) {
      transaction.add(createAssociateTokenInstruction)
    }

    const addLiquidityInstruction = this.marinadeFinanceProgram.addLiquidityInstruction({
      amountLamports,
      accounts: await this.marinadeFinanceProgram.addLiquidityInstructionAccounts({
        marinadeState,
        associatedLPTokenAccountAddress,
        ownerAddress,
      }),
    })

    transaction.add(addLiquidityInstruction)

    return {
      associatedLPTokenAccountAddress,
      transaction,
    }
  }

  /**
   * Returns a transaction with the instructions to
   * Burn LP tokens and get SOL and mSOL back from the liquidity pool
   *
   * @param {BN} amountLamports - The amount of LP tokens burned
   */
  async removeLiquidity(amountLamports: BN): Promise<MarinadeResult.RemoveLiquidity> {
    const ownerAddress = assertNotNullAndReturn(this.config.publicKey, ErrorMessage.NO_PUBLIC_KEY)
    const marinadeState = await this.getMarinadeState()
    const transaction = new web3.Transaction()

    const associatedLPTokenAccountAddress = await getAssociatedTokenAccountAddress(marinadeState.lpMintAddress, ownerAddress)

    const {
      associatedTokenAccountAddress: associatedMSolTokenAccountAddress,
      createAssociateTokenInstruction,
    } = await getOrCreateAssociatedTokenAccount(this.provider, marinadeState.mSolMintAddress, ownerAddress)

    if (createAssociateTokenInstruction) {
      transaction.add(createAssociateTokenInstruction)
    }

    const removeLiquidityInstruction = this.marinadeFinanceProgram.removeLiquidityInstruction({
      amountLamports,
      accounts: await this.marinadeFinanceProgram.removeLiquidityInstructionAccounts({
        marinadeState,
        ownerAddress,
        associatedLPTokenAccountAddress,
        associatedMSolTokenAccountAddress,
      }),
    })

    transaction.add(removeLiquidityInstruction)

    return {
      associatedLPTokenAccountAddress,
      associatedMSolTokenAccountAddress,
      transaction,
    }
  }

  /**
   * Returns a transaction with the instructions to
   * Stake SOL in exchange for mSOL
   *
   * @param {BN} amountLamports - The amount lamports staked
   * @param {DepositOptions=} options - Additional deposit options
   */
  async deposit(amountLamports: BN, options: DepositOptions = {}): Promise<MarinadeResult.Deposit> {
    const feePayer = assertNotNullAndReturn(this.config.publicKey, ErrorMessage.NO_PUBLIC_KEY)
    const mintToOwnerAddress = assertNotNullAndReturn(options.mintToOwnerAddress ?? this.config.publicKey, ErrorMessage.NO_PUBLIC_KEY)
    const msolTokenAccountAuthority = assertNotNullAndReturn(this.config.msolTokenAccountAuthority, ErrorMessage.NO_PUBLIC_KEY)
    const marinadeState = await this.getMarinadeState()
    const transaction = new web3.Transaction()

    const {
      associatedTokenAccountAddress: associatedMSolTokenAccountAddress,
      createAssociateTokenInstruction: createMSolAssociateTokenInstruction,
    } = await getOrCreateAssociatedTokenAccount(this.provider, marinadeState.mSolMintAddress, this.config.msolTokenAccountAuthority, feePayer)

    // use the same authority PDA for the msol account and the liquidity pool token account for convenience
    const {
      associatedTokenAccountAddress: associatedLiqPoolTokenAccountAddress,
      createAssociateTokenInstruction: createLiqPoolAssociateTokenInstruction,
    } = await getOrCreateAssociatedTokenAccount(this.provider, marinadeState.lpMintAddress, this.config.msolTokenAccountAuthority, feePayer)

    if (createMSolAssociateTokenInstruction) {
      transaction.add(createMSolAssociateTokenInstruction)
    }

    if (createLiqPoolAssociateTokenInstruction) {
      transaction.add(createLiqPoolAssociateTokenInstruction)
    }

    // Get proxy sol account (must exist)
    const associatedProxySolTokenAccountAddress = await getAssociatedTokenAccountAddress(
      this.config.proxySolMintAddress,
      mintToOwnerAddress,
    )

    const program = this.provideReferralOrMainProgram()
    const depositInstruction = await program.depositInstructionBuilder({
      amountLamports,
      proxyStateAddress: this.config.proxyStateAddress,
      marinadeState,
      transferFrom: feePayer,
      associatedMSolTokenAccountAddress,
      msolTokenAccountAuthority,
      proxySolMintAddress: this.config.proxySolMintAddress,
      proxySolMintAuthority: this.config.proxySolMintAuthority,
      associatedLiqPoolTokenAccountAddress,
      associatedProxySolTokenAccountAddress,
    })

    transaction.add(depositInstruction)

    return {
      associatedMSolTokenAccountAddress,
      transaction,
    }
  }

  /**
   * Returns a transaction with the instructions to
   * Swap your mSOL to get back SOL immediately using the liquidity pool
   *
   * @param {BN} amountLamports - The amount of mSOL exchanged for SOL
   * @param associatedMSolTokenAccountAddress
   */
  async liquidUnstake(amountLamports: BN, associatedMSolTokenAccountAddress?: web3.PublicKey): Promise<MarinadeResult.LiquidUnstake> {
    const ownerAddress = assertNotNullAndReturn(this.config.publicKey, ErrorMessage.NO_PUBLIC_KEY)
    const [msolTokenAccountAuthority, bump] = this.deriveTokenAccountAddress()
    const marinadeState = await this.getMarinadeState()
    const transaction = new web3.Transaction()

    // if msol address not passed in, derive it from the msol authority
    if (!associatedMSolTokenAccountAddress) {
      associatedMSolTokenAccountAddress = await getAssociatedTokenAccountAddress(marinadeState.mSolMintAddress, this.config.msolTokenAccountAuthority)
    }

    // Get proxy sol account (must exist)
    const associatedProxySolTokenAccountAddress = await getAssociatedTokenAccountAddress(
      this.config.proxySolMintAddress,
      ownerAddress,
    )

    const program = this.provideReferralOrMainProgram()
    const liquidUnstakeInstruction = await program.liquidUnstakeInstructionBuilder({
      amountLamports,
      proxyStateAddress: this.config.proxyStateAddress,
      proxySolMintAddress: this.config.proxySolMintAddress,
      proxySolMintAuthority: this.config.proxySolMintAuthority,
      associatedProxySolTokenAccountAddress,
      proxyTreasury: this.config.proxyTreasury,
      marinadeState,
      ownerAddress,
      associatedMSolTokenAccountAddress,
      msolTokenAccountAuthority,
      bump,
    })

    transaction.add(liquidUnstakeInstruction)

    return {
      associatedMSolTokenAccountAddress,
      transaction,
    }
  }

  /**
   * Returns a transaction with the instructions to
   * Order a delayed unstake of mSOL and create a ticket account to claim later
   *
   * @param {BN} amountLamports - The amount of mSOL exchanged for SOL
   * @param associatedMSolTokenAccountAddress
   */
  async orderUnstake(amountLamports: BN, associatedMSolTokenAccountAddress?: web3.PublicKey): Promise<MarinadeResult.OrderUnstake> {
    const ownerAddress = assertNotNullAndReturn(this.config.publicKey, ErrorMessage.NO_PUBLIC_KEY)
    const [msolTokenAccountAuthority, bump] = this.deriveTokenAccountAddress()
    const marinadeState = await this.getMarinadeState()
    const transaction = new web3.Transaction()

    // if msol address not passed in, derive it from the msol authority
    if (!associatedMSolTokenAccountAddress) {
      associatedMSolTokenAccountAddress = await getAssociatedTokenAccountAddress(marinadeState.mSolMintAddress, this.config.msolTokenAccountAuthority)
    }

    // Get proxy sol account (must exist)
    const associatedProxySolTokenAccountAddress = await getAssociatedTokenAccountAddress(
      this.config.proxySolMintAddress,
      ownerAddress,
    )

    const newTicketAccountSpace = 32 + 32 + 8 + 8 + 8
    const newTicketLamports = await this.provider.connection.getMinimumBalanceForRentExemption(newTicketAccountSpace)
    const newTicketAccount = web3.Keypair.generate()
    transaction.add(web3.SystemProgram.createAccount({
      fromPubkey: ownerAddress,
      newAccountPubkey: newTicketAccount.publicKey,
      space: newTicketAccountSpace,
      lamports: newTicketLamports,
      programId: marinadeState.marinadeFinanceProgramId,
    }))

    const proxyTicketAccount = web3.Keypair.generate()

    const program = this.provideReferralOrMainProgram()
    const orderUnstakeInstruction = await program.orderUnstakeInstructionBuilder({
      amountLamports,
      proxyStateAddress: this.config.proxyStateAddress,
      proxySolMintAddress: this.config.proxySolMintAddress,
      proxySolMintAuthority: this.config.proxySolMintAuthority,
      proxyTreasury: this.config.proxyTreasury,
      marinadeState,
      ownerAddress,
      associatedMSolTokenAccountAddress,
      associatedProxySolTokenAccountAddress,
      msolTokenAccountAuthority,
      newTicketAccount: newTicketAccount.publicKey,
      proxyTicketAccount: proxyTicketAccount.publicKey,
      bump,
    })

    transaction.add(orderUnstakeInstruction)

    return {
      newTicketAccount,
      proxyTicketAccount,
      transaction,
    }
  }

  /**
   * Returns a transaction with the instructions to
   * Deposit a delegated stake account.
   * Note that the stake must be fully activated and the validator must be known to Marinade
   *
   * @param {web3.PublicKey} stakeAccountAddress - The account to be deposited
   */
  async depositStakeAccount(stakeAccountAddress: web3.PublicKey): Promise<MarinadeResult.DepositStakeAccount> {
    const ownerAddress = assertNotNullAndReturn(this.config.publicKey, ErrorMessage.NO_PUBLIC_KEY)
    const marinadeState = await this.getMarinadeState()
    const transaction = new web3.Transaction()
    const currentEpoch = await this.provider.connection.getEpochInfo()
    const stakeAccountInfo = await getParsedStakeAccountInfo(this.provider, stakeAccountAddress)

    const { authorizedWithdrawerAddress, voterAddress, activationEpoch, isCoolingDown } = stakeAccountInfo

    if (!authorizedWithdrawerAddress) {
      throw new Error('Withdrawer address is not available!')
    }

    if (!activationEpoch || !voterAddress) {
      throw new Error('The stake account is not delegated!')
    }

    if (isCoolingDown) {
      throw new Error('The stake is cooling down!')
    }

    const waitEpochs = 2
    const earliestDepositEpoch = activationEpoch.addn(waitEpochs)
    if (earliestDepositEpoch.gtn(currentEpoch.epoch)) {
      throw new Error(`Deposited stake ${stakeAccountAddress} is not activated yet. Wait for #${earliestDepositEpoch} epoch`)
    }

    const { validatorRecords } = await marinadeState.getValidatorRecords()
    const validatorLookupIndex = validatorRecords.findIndex(({ validatorAccount }) => validatorAccount.equals(voterAddress))
    const validatorIndex = validatorLookupIndex === -1 ? marinadeState.state.validatorSystem.validatorList.count : validatorLookupIndex

    const duplicationFlag = await marinadeState.validatorDuplicationFlag(voterAddress)

    const {
      associatedTokenAccountAddress: associatedMSolTokenAccountAddress,
      createAssociateTokenInstruction,
    } = await getOrCreateAssociatedTokenAccount(this.provider, marinadeState.mSolMintAddress, ownerAddress)

    if (createAssociateTokenInstruction) {
      transaction.add(createAssociateTokenInstruction)
    }

    const program = this.provideReferralOrMainProgram()
    const depositStakeAccountInstruction = await program.depositStakeAccountInstructionBuilder({
      validatorIndex,
      marinadeState,
      duplicationFlag,
      authorizedWithdrawerAddress,
      associatedMSolTokenAccountAddress,
      ownerAddress,
      stakeAccountAddress,
    })

    transaction.add(depositStakeAccountInstruction)

    return {
      associatedMSolTokenAccountAddress,
      voterAddress,
      transaction,
      mintRatio: marinadeState.mSolPrice,
    }
  }

  /**
   * Returns a transaction with the instructions to
   * Liquidate a delegated stake account.
   * Note that the stake must be fully activated and the validator must be known to Marinade
   * and that the transaction should be executed immediately after creation.
   *
   * @param {web3.PublicKey} stakeAccountAddress - The account to be deposited
   * @param {BN} mSolToKeep - Optional amount of mSOL lamports to keep
   */
  async liquidateStakeAccount(stakeAccountAddress: web3.PublicKey, mSolToKeep?: BN): Promise<MarinadeResult.LiquidateStakeAccount> {
    const totalBalance = await this.provider.connection.getBalance(stakeAccountAddress)
    const rent = await this.provider.connection.getMinimumBalanceForRentExemption(web3.StakeProgram.space)
    const stakeBalance = new BN(totalBalance - rent)
    const marinadeState = await this.getMarinadeState()

    const { transaction: depositTx, associatedMSolTokenAccountAddress, voterAddress } =
      await this.depositStakeAccount(stakeAccountAddress)

    let mSolAmountToReceive = computeMsolAmount(stakeBalance, marinadeState)
    // when working with referral partner the costs of the deposit operation is subtracted from the mSOL amount the user receives
    if (this.isReferralProgram()) {
      const partnerOperationFee = (await this.marinadeReferralProgram.getReferralStateData()).operationDepositStakeAccountFee
      mSolAmountToReceive = mSolAmountToReceive.sub(proportionalBN(mSolAmountToReceive, new BN(partnerOperationFee), new BN(10_000)))
    }

    const unstakeAmountMSol = mSolAmountToReceive.sub(mSolToKeep ?? new BN(0))
    const { transaction: unstakeTx } = await this.liquidUnstake(unstakeAmountMSol, associatedMSolTokenAccountAddress)

    return {
      transaction: depositTx.add(unstakeTx),
      associatedMSolTokenAccountAddress,
      voterAddress,
    }
  }

  /**
   * @todo
   */
  async getDelayedUnstakeTickets(beneficiary?: web3.PublicKey): Promise<Map<web3.PublicKey, TicketAccount>> {

    return this.marinadeFinanceProgram.getDelayedUnstakeTickets(beneficiary)
  }

  async getDelayedUnstakeTicket(ticketAccountAddress: web3.PublicKey): Promise<TicketAccount | null> {
    return this.marinadeFinanceProgram.getDelayedUnstakeTicket(ticketAccountAddress)
  }

  /**
   * Returns estimated Due date for an unstake ticket created now
   *
   */
  async getEstimatedUnstakeTicketDueDate() {
    const marinadeState = await this.getMarinadeState()
    return this.marinadeFinanceProgram.getEstimatedUnstakeTicketDueDate(marinadeState)
  }
}
