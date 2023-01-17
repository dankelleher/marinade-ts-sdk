import { web3 } from '@project-serum/anchor'

const DEFAULT_PROVIDER_URL = 'https://api.devnet.solana.com'

export class MarinadeConfig {
  proxyProgramId = new web3.PublicKey('sunzv8N3A8dRHwUBvxgRDEbWKk8t7yiHR4FLRgFsTX6')
  proxyStateAddress = new web3.PublicKey('11111111111111111111111111111111') // TODO - we don't know this yet
  proxySolMintAddress = new web3.PublicKey('11111111111111111111111111111111') // TODO - we don't know this yet
  proxySolMintAuthority = new web3.PublicKey('11111111111111111111111111111111') // TODO - we don't know this yet
  msolTokenAccountAuthority = new web3.PublicKey('11111111111111111111111111111111') // TODO - we can derive this from the mintToOwnerAddress field - see deriveTokenAccountAddress in liquidUnstake
  proxyTreasury = new web3.PublicKey('11111111111111111111111111111111') // TODO - pass in proxy state  to obtain this
  marinadeFinanceProgramId = new web3.PublicKey('MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD')
  marinadeReferralProgramId = new web3.PublicKey('MR2LqxoSbw831bNy68utpu5n4YqBH3AzDmddkgk9LQv')

  marinadeStateAddress = new web3.PublicKey('8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC')
  marinadeReferralGlobalStateAddress = new web3.PublicKey('MRSh4rUNrpn7mjAq9ENHV4rvwwPKMij113ScZq3twp2')

  stakeWithdrawAuthPDA = new web3.PublicKey('9eG63CdHjsfhHmobHgLtESGC8GabbmRcaSpHAZrtmhco')

  connection = new web3.Connection(DEFAULT_PROVIDER_URL)
  publicKey: web3.PublicKey | null = null

  referralCode: web3.PublicKey | null = null

  constructor(configOverrides: Partial<MarinadeConfig> = {}) {
    Object.assign(this, configOverrides)
  }
}
