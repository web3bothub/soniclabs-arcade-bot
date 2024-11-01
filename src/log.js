import { createLogger, format, transports } from "winston"
import { PRIVATE_KEYS } from "./config.js"

const { combine, timestamp, printf, colorize } = format
const logFormat = printf(
  ({ level: level, message: message, timestamp: timestamp }) => {
    return `${timestamp} [${level}]: ${message}`
  }
)

class Log {
  constructor() {
    this.loggers = {
      app: createLogger({
        level: "debug",
        format: combine(
          timestamp({
            format: "YYYY-MM-DD HH:mm:ss",
          }),
          colorize(),
          logFormat
        ),
        transports: [new transports.File({ filename: 'logs/app.log' })],
        exceptionHandlers: [new transports.File({ filename: 'logs/app.log' })],
        rejectionHandlers: [new transports.File({ filename: 'logs/app.log' })],
      })
    }
  }

  getLogger(account) {
    if (account && account.startsWith('0x')) {
      account = PRIVATE_KEYS.indexOf(account)
    }

    if (!this.loggers[account]) {
      this.loggers[account] = createLogger({
        level: "debug",
        format: combine(
          timestamp({
            format: "YYYY-MM-DD HH:mm:ss",
          }),
          colorize(),
          logFormat
        ),
        transports: [new transports.File({ filename: `logs/${account}.log` })],
        exceptionHandlers: [new transports.File({ filename: `logs/${account}.log` })],
        rejectionHandlers: [new transports.File({ filename: `logs/${account}.log` })],
      })
    }

    return this.loggers[account]
  }

  info(account, message) {
    this.getLogger(account).info(message)
  }
  warn(account, message) {
    this.getLogger(account).warn(message)
  }
  error(account, message) {
    this.getLogger(account).error(message)
  }
  debug(account, message) {
    this.getLogger(account).debug(message)
  }
  setLevel(account, message) {
    this.getLogger(account).level = message
  }
}

export default new Log()
