import fs from "fs"
import App from './app.js'
import { PRIVATE_KEYS, PROXIES, SMART_ADDRESSES } from './config.js'
import log from './log.js'
import Output from './output.js'
import { toHumanTime, wait } from './utils.js'

async function play(app, game) {
  while (!app.limitedGames[game]) {
    const method = 'play' + game.charAt(0).toUpperCase() + game.slice(1)
    try {
      await app[method]()
      await app.getPoints()
    } catch (error) {
      await app.gameWait(game, 30000, error)
    }
  }
}

async function run(account, smartAddress, proxy) {
  const app = new App(account, smartAddress, proxy)
  try {
    log.info(account, `Initializing account: ${PRIVATE_KEYS.indexOf(account) + 1} (${account})`)
    await app.connect()
    await app.getBalance()
    await app.connectToSonic()
    await app.getUser()
    await app.getPoints()
    await app.tryToUpdateReferrer()
    await app.createSession()
    await app.permitTypedMessage()

    await play(app, 'plinko')
    await play(app, 'singlewheel')
    await play(app, 'mines')

    // Schedule next cycle
    const duration = 8 * 3600 * 1000 // 8h
    log.info(account, `Cycle complete for account ${app.address}. pausing for ${toHumanTime(duration)}`)
    await wait(duration, `Delaying for next cycle: ${toHumanTime(duration)}`, app)

    return run(account, smartAddress, proxy)  // Restart cycle
  } catch (error) {
    log.info(account, `Error encountered. retrying in 120 seconds.`)
    await wait(120000, `Error: ${error.message || JSON.stringify(error)}. retrying in 120 seconds`, app)
    return run(account, smartAddress, proxy)  // Retry operation
  }
}

async function startBot() {
  try {
    if (PROXIES.length !== PRIVATE_KEYS.length && PROXIES.length !== 0) {
      throw new Error(`the number of proxies must match the number of accounts or be empty.`)
    }

    const tasks = PRIVATE_KEYS.map((account, index) => {
      run(account, SMART_ADDRESSES[index] || undefined, PROXIES[index] || undefined)
      log.info(account, `started account: ${account}`)
    })

    await Promise.all(tasks)
  } catch (error) {
    console.error('Bot halted due to error:', error)
  }
}

(async () => {
  try {
    fs.rmSync('logs/', { recursive: true })
    console.clear()
    console.log('----------------- SonicLabs Arcade BOT ------------------')
    console.log(' Ensure your bot is up-to-date by running: ')
    console.log(' git reset --hard && git pull')
    console.log('---------------------------------------------------------')

    await startBot()
  } catch (error) {
    Output.clearInfo()
    console.error('Critical error encountered, restarting...', error)
    await startBot()  // Retry after error
  }
})()
