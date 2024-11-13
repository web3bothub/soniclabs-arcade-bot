import { ethers } from 'ethers'
import { writeFile } from 'fs/promises'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { CONTRACT as CONTRACT_ADDRESS, GAMES, PRIVATE_KEYS, REFERRER_CODE, RPC } from './config.js'
import log from './log.js'
import { getPrivateKeyType, getRandomUserAgent, toHumanTime, wait } from './utils.js'

export default class App {
  constructor(account, smartAddress, proxy) {
    this.baseUrl = 'https://arcade.soniclabs.com'
    this.host = 'arcade.soniclabs.com'
    this.origin = 'https://arcade.soniclabs.com'
    this.userAgent = getRandomUserAgent()
    this.proxy = proxy
    this.sessionId = 1
    this.wallet = null
    this.today_points = null
    this.total_points = null
    this.account = account
    this.address = null
    this.smartAddress = smartAddress
    this.permitSignature = null
    this.referrerCode = REFERRER_CODE
    this.sessionKey = `./.sessions/${account}`
    this.limitedGames = {
      plinko: false,
      singlewheel: false,
      mines: false,
    }
    this.gameStatus = {
      plinko: { message: 'pending', waiting: '-' },
      singlewheel: { message: 'pending', waiting: '-' },
      mines: { message: 'pending', waiting: '-' },
    }

    try {
      this.provider = new ethers.JsonRpcProvider(RPC.RPCURL, RPC.CHAINID)
    } catch (error) {
      log.error(this.account, `Failed to connect to testnet: ${error}`)
    }
  }

  async gameWait(game, milliseconds, message) {
    this.gameStatus[game].message = message
    this.gameStatus[game].waiting = toHumanTime(milliseconds)

    await wait(milliseconds, message, this)
  }

  async connect() {
    try {
      const cleanPrivateKey = this.account.replace(/^0x/, '')
      await wait(1500, 'Connecting to account: ' + (PRIVATE_KEYS.indexOf(this.account) + 1), this)
      const accountType = getPrivateKeyType(cleanPrivateKey)
      log.info(this.account, 'Account type: ' + accountType)

      if (accountType === 'Mnemonic') {
        this.wallet = ethers.Wallet.fromMnemonic(cleanPrivateKey, this.provider)
      } else if (accountType === 'Private Key') {
        this.wallet = new ethers.Wallet(cleanPrivateKey, this.provider)
      } else {
        throw new Error('Invalid account Secret Phrase or Private Key')
      }

      this.address = this.wallet.address
      await wait(1000, 'Wallet address: ' + JSON.stringify(this.address), this)
    } catch (error) {
      throw error
    }
  }

  async createSession() {
    await wait(1000, 'Creating session', this)

    const response = await this.fetch('https://arcade.hub.soniclabs.com/rpc', 'POST', {
      jsonrpc: '2.0',
      id: this.sessionId,
      method: 'createSession',
      params: {
        owner: this.wallet.address,
        until: Date.now() + 86400000 // 24 hours in milliseconds
      }
    }, { network: 'SONIC', pragma: 'no-cache', 'X-Owner': this.address }, 'https://arcade.soniclabs.com/', true)

    this.sessionId += 1
    if (response.status === 200) {
      writeFile(this.sessionKey, Date.now().toString())
      await wait(1000, 'Successfully create session', this)
    } else {
      throw Error('Failed to create session')
    }
  }

  async getBalance(refresh = false) {
    try {
      if (!refresh) {
        await wait(500, 'Fetching balance of address: ' + this.wallet.address, this)
      }
      this.balance = ethers.formatEther(await this.provider.getBalance(this.wallet.address))
      await wait(500, 'Balance updated: ' + this.balance, this)
    } catch (error) {
      log.error(this.account, `Failed to get balance: ${error}`)
      throw error
    }
  }

  async getUser() {
    await wait(1000, 'Fetching user information', this)
    const response = await this.fetch(`https://airdrop.soniclabs.com/api/trpc/user.findOrCreate?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: { address: this.wallet.address } } }))}`, 'GET')
    if (response.status == 200) {
      this.user = response[0].result.data.json
      await wait(500, 'User information retrieved successfully', this)
    } else {
      throw new Error('Failed to get user information')
    }
  }

  async getPoints() {
    if (!this.smartAddress) {
      await wait(500, 'Smart address not configured, skip', this)
    }
    await wait(1000, "Getting user points", this)
    const response = await this.fetch(`https://arcade.gateway.soniclabs.com/game/points-by-player?wallet=${this.smartAddress}`, 'GET', undefined, undefined, 'https://arcade.soniclabs.com/', true)

    if (response.status == 200) {
      this.today_points = response.today
      this.total_points = response.totalPoints
      await wait(1500, "Successfully get total points", this)
    } else {
      //throw Error("Failed to get points")
    }
  }

  async register() {
    try {
      wait(15000, 'Registering user key')
      const abi = new ethers.Interface([{
        'inputs': [{
          'internalType': "address",
          'name': 'spender',
          'type': "address"
        }, {
          'internalType': "uint256",
          'name': 'amount',
          'type': "uint256"
        }],
        'name': 'approve',
        'outputs': [{
          'internalType': "bool",
          'name': '',
          'type': "bool"
        }],
        'stateMutability': "nonpayable",
        'type': 'function'
      }])
      const data = abi.encodeFunctionData("approve", [this.address, ethers.MaxUint256])
      const response = await this.fetch("https://arcade.hub.soniclabs.com/rpc", "POST", {
        'jsonrpc': "2.0",
        'id': 0x7,
        'method': "call",
        'params': {
          'call': {
            'dest': '0x4Cc7b0ddCD0597496E57C5325cf4c73dBA30cdc9',
            'data': data,
            'value': '0n'
          },
          'owner': this.address,
          'part': this.part,
          'permit': this.permitSignature
        }
      }, {
        'network': "SONIC",
        'pragma': "no-cache",
        'priority': "u=1, i",
        'X-Owner': this.address
      }, "https://arcade.soniclabs.com/", true)
      this.sessionId += 1
      if (response.status == 200) {
        await wait(1500, "User key registered", this)
        await this.getPoints()
      } else {
        await wait(1000, "Failed to register user key", this)
        await this.register()
      }
    } catch (error) {
      await this.register()
    }
  }

  async refund(game) {
    await wait(1500, `Refunding game ${game} to resolve awaiting random number`, this)
    const response = await this.fetch('https://arcade.hub.soniclabs.com/rpc', "POST", {
      'jsonrpc': "2.0",
      'id': this.sessionId,
      'method': "refund",
      'params': {
        'game': game,
        'player': this.smartAddress
      }
    }, {
      'network': "SONIC",
      'X-Owner': this.address
    }, "https://arcade.soniclabs.com/", true)
    this.sessionId += 0x1
    if (response.status == 0xc8) {
      await wait(2000, `Successfully refund game: ${game}`, this)
    } else {
      throw Error("Failed to Refund Game")
    }
  }

  async reIterate(game) {
    await wait(1500, `Reiterate game ${game} to resolve awaiting random number`, this)
    const response = await this.fetch("https://arcade.hub.soniclabs.com/rpc", "POST", {
      'jsonrpc': '2.0',
      'id': this.sessionId,
      'method': "reIterate",
      'params': {
        'game': game,
        'player': this.smartAddress
      }
    }, {
      'network': "SONIC",
      'X-Owner': this.address
    }, "https://arcade.soniclabs.com/", true)
    this.sessionId += 0x1
    if (response.status == 0xc8) {
      await wait(2000, `Successfully reiterate game: ${game}`, this)
    } else {
      throw Error(`Failed to reiterate game ${game}`)
    }
  }

  async connectToSonic() {
    await wait(500, 'Connecting to Sonic Arcade', this)

    const messageToSign = "I'm joining Sonic Airdrop Dashboard with my wallet, have been referred by " + this.referrerCode + ", and I agree to the terms and conditions.\nWallet address:\n" + this.address + "\n"
    log.info(this.account, 'Message to sign: ' + messageToSign)

    this.signatureMessage = await this.wallet.signMessage(messageToSign)
    log.info(this.account, 'signature: ' + this.signatureMessage)

    await wait(500, 'Successfully connected to Sonic Dapp', this)
  }

  async tryToUpdateReferrer() {
    try {
      await wait(100, 'Validating invite code', this)

      if (this.user.invitedCode == null) {
        const response = await this.fetch('/api/trpc/user.setInvited?batch=1', 'POST', {
          json: { address: this.wallet.address, invitedCode: this.invitedCode, signature: this.signatureMessage }
        })

        if (response.status == 200) {
          await wait(1000, 'Successfully updated the invite code', this)
          await this.getUser()
        }
      } else {
        await wait(1000, 'Invite code already set', this)
      }
    } catch (error) {
      log.error(this.account, `Failed to update user invite code: ${error}`)
    }
  }

  async permitTypedMessage() {
    await wait(1000, 'Try to permit Sonic Arcade contract', this)
    const response = await this.fetch('https://arcade.hub.soniclabs.com/rpc', 'POST', {
      'id': this.sessionId,
      'jsonrpc': '2.0',
      'method': 'permitTypedMessage',
      'params': {
        'owner': this.address
      }
    }, {
      'network': 'SONIC',
      'pragma': 'no-cache',
      'priority': 'u=1, i',
      'X-Owner': this.address
    }, 'https://arcade.soniclabs.com/', true)
    this.sessionId += 1

    if (!response.error && response.status == 200 ) {
      const message = JSON.parse(response.result.typedMessage)
      await wait(500, 'Successfully create permit', this)
      await wait(500, 'Approving permit message', this)
      this.permitSignature = await this.wallet.signTypedData(message.json.domain, message.json.types, message.json.message)
      await this.permit()
    } else {
      if (response.status == 401) {
        await wait(4000, 'Failed to permit Sonic Arcade contract, Maybe anti-bot protection, try to play the games on the website first.', this)
        await this.createNonce()
      }

      throw Error('Failed to Create Sonic Arcade Sessions')
    }
  }

  async createNonce() {
    await wait(500, 'Creating nonce', this)
    const response = await this.fetch('https://arcade.hub.soniclabs.com/rpc', 'POST', {
      jsonrpc: '2.0',
      id: this.sessionId,
      method: 'createNonce',
      params: {
        owner: this.address
      }
    }, { network: 'SONIC', pragma: 'no-cache', 'X-Owner': this.address }, 'https://arcade.soniclabs.com/', true)

    this.sessionId += 1
    if (response.status == 200) {
      await wait(500, 'Successfully created nonce', this)
    } else {
      throw Error('Failed to create nonce, please play the games on the website first.')
    }
  }

  async performRpcRequest(method, params, headers, referer) {
    return this.fetch('https://arcade.hub.soniclabs.com/rpc', 'POST', {
      jsonrpc: '2.0',
      id: this.sessionId,
      method: method,
      params: params
    }, headers || { network: 'SONIC', pragma: 'no-cache', 'priority': 'u=1, i', 'X-Owner': this.address }, 'https://arcade.soniclabs.com/')
  }

  async permit() {
    await wait(500, 'Submitting contract permit', this)
    const response = await this.performRpcRequest('permit', {
      owner: this.address,
      signature: this.permitSignature
    })
    this.sessionId += 1
    if (!response.error) {
      this.part = response.result.hashKey
      await wait(500, 'Permit submitted successfully', this)
    } else {
      throw new Error(`Failed to submit permit: ${response.error.message}`)
    }
  }

  async playPlinko() {
    await this.playGame('plinko')
  }

  async playSinglewheel() {
    await this.playGame('singlewheel')
  }

  async playMines() {
    await this.playGame('mines')

    if (this.limitedGames['mines']) {
      return
    }

    await this.gameWait('mines', 600, "Placed", this)
    await this.gameWait('mines', 100, "Claiming mine game reward", this)

    const response = await this.fetch('https://arcade.hub.soniclabs.com/rpc', 'POST', {
      'jsonrpc': "2.0",
      'id': this.sessionId,
      'method': "call",
      'params': {
        'call': {
          'dest': CONTRACT_ADDRESS,
          'data': "0x0d942fd00000000000000000000000008bbd8f37a3349d83c85de1f2e32b3fd2fce2468e0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000e328a0b1e0be7043c9141c2073e408d1086e117500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000007656e6447616d65000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
          'value': '0n'
        },
        'owner': this.address,
        'part': this.part,
        'permit': this.permitSignature
      }
    }, {
      'network': "SONIC",
      'pragma': "no-cache",
      'priority': "u=1, i",
      'X-Owner': this.address
    }, 'https://arcade.soniclabs.com/', true)

    if (response.error) {
      await this.gameWait('mines', 10000, `Failed to claim mine game: ${response.error?.["message"]}`, this)
    }

    if (response.result?.["hash"]?.['errorTypes']) {
      await this.gameWait('mines', 10000, `Claim failed: ${response.result?.["hash"]?.["actualError"]?.["details"]}`, this)
    } else {
      await this.gameWait('mines', 1500, "Successfully play and claim mine game.", this)
    }
  }

  async playGame(name) {
    if (!Object.prototype.hasOwnProperty.call(GAMES, name)) {
      throw new Error(`Undefined game: [${name}]`)
    }

    const callData = GAMES[name]

    await this.gameWait(name, 1000, `Playing game: [${name}]`, this)

    let errorMessage = ''

    try {
      const response = await this.performRpcRequest('call', {
        call: callData,
        owner: this.address,
        part: this.part,
        permit: this.permitSignature
      })

      this.sessionId += 1

      if (!response.error) {
        return await this.gameWait(name, 2000, `Successfully played game: [${name}]`, this)
      }

      errorMessage = response.error?.message || ''

      if (response.result?.["hash"]?.["errorTypes"]) {
        await wait(3000, `Play game failed: ${response.result?.["hash"]?.["actualError"]?.['details']}`, this)
        return
      }
    } catch (error) {
      errorMessage = error.message
    }

    log.error(this.account, errorMessage)

    if (errorMessage.includes('Please refresh or try again later')) {
      await this.createSession()
      await this.createNonce()
      return await this.playGame(name)
    }

    if (errorMessage.includes('Locked')) {
      return await this.gameWait(name, 1.8 * 3600, "Accout has been banned, wait for 1.8 hours", this)
    }

    if (errorMessage.includes('limit') || errorMessage.includes('Locked')) {
      this.limitedGames[name] = true
      return await this.gameWait(name, 1000, errorMessage, this)
    }

    if (errorMessage.includes('random number')) {
      await this.gameWait(name, 5000, errorMessage, this)
      return await this.reIterate(name)
    }

    if (errorMessage.includes('Permit could not verify')) {
      await this.register()
      throw new Error(`Failed to play game: [${name}]，error: ${errorMessage}`)
    }

    if (errorMessage.length > 0) {
      throw new Error(`Failed to play game: [${name}], error: ${errorMessage}`)
    }
  }

  async fetch(url, method, body = {}, customHeaders = {}, referer) {
    log.info(this.account, `Fetching: ${url}`)
    const requestUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`
    const headers = {
      ...customHeaders, ...{
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        'Content-Type': 'application/json',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'cors',
        'Host': this.host,
        'Origin': this.origin,
        'Pragma': 'no-cache',
        'Referer': this.origin,
        'User-Agent': this.userAgent,
      }
    }

    const options = { method, headers, referer }

    log.info(this.account, `${method} Request URL: ${requestUrl}`)
    log.info(this.account, `Request headers: ${JSON.stringify(headers)}`)

    if (method !== 'GET') {
      options.body = JSON.stringify(body)
      log.info(this.account, `Request body: ${options.body}`)
    }

    if (this.proxy) {
      options.agent = new HttpsProxyAgent(this.proxy, { rejectUnauthorized: false })
    }

    const response = await fetch(requestUrl, options)

    log.info(this.account, `Response status: ${response.status} ${response.statusText}`)

    const contentType = response.headers.get('content-type')
    let responseData = contentType && contentType.includes('application/json')
      ? await response.json()
      : { status: response.status, message: await response.text() }

    log.info(this.account, `Response data: ${JSON.stringify(responseData)}`)

    if (response.ok) {
      responseData.status = 200 // Normalize status to 200 for successful responses
      return responseData
    } else {
      throw new Error(`${response.status} - ${response.statusText}`)
    }
  }
}
