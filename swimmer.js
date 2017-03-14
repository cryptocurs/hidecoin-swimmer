'use strict'

console.log('Hidecoin Swimmer')

const net = require('net')
const crypto = require('crypto')
const bs58 = require('bs58')

const REQUEST_TASK = Buffer.from([0x00])
const TAKE_TASK = Buffer.from([0x01])
const BLOCK_FOUND = Buffer.from([0x02])
const ACCEPTED = Buffer.from([0xf0])
const SUSPEND = Buffer.from([0xfe])
const ERROR = Buffer.from([0xff])

const helperUnixTimeMs = () => {
  return new Date().getTime()
}

const helperHashOnce = (data) => {
  return crypto.createHash('sha256').update(data).digest()
}

const helperHash = (data) => {
  return helperHashOnce(helperHashOnce(data))
}

const addressHashToRaw = (address) => {
  return Buffer.from(bs58.decode(address))
}

const addressIsValid = (address) => {
  try {
    const decoded = address instanceof Buffer ? address : Buffer.from(bs58.decode(address))
    const basic = decoded.slice(0, 21)
    const checksum = decoded.slice(21)
    const basicChecksum = helperHashOnce(basic).slice(0, 4)
    return (checksum.equals(basicChecksum))
  } catch(e) {
    return false
  }
}

const blockSet = (buffer, data) => {
  if (data.nonceRaw !== undefined) {
    data.nonceRaw.copy(buffer, 73)
  }
  if (data.nonceLow !== undefined) {
    buffer.writeIntBE(data.nonceLow, 76, 5)
  }
}

const blockCalcHash = (data, target = null) => {
  const hash = helperHash(data)
  return (hash.compare(target || data.slice(41, 73)) > 0 ? false : hash)
}

let currentTask = null
let currentNonce = 0

const {argv} = process
if (argv.length !== 4) {
  console.log('Format:')
  console.log('node poolClient POOL_HOST:POOL_PORT HIDECOIN_ADDRESS')
  process.exit()
}
const [host, port] = argv[2].split(':')
const address = addressHashToRaw(argv[3])
if (!addressIsValid(address)) {
  console.log(argv[3], 'is not valid hidecoin address')
  process.exit()
}

const client = new net.Socket()
client.on('data', (data) => {
  const cmd = data.slice(0, 1)
  if (cmd.equals(TAKE_TASK)) {
    const nonce = data.slice(1, 9)
    const targetDiff = data.slice(9, 41)
    const blockHeaderSize = data.readUInt32BE(41)
    const blockHeader = data.slice(45, 45 + blockHeaderSize)
    
    if (!currentTask || !nonce.equals(currentTask.nonce) || !targetDiff.equals(currentTask.targetDiff) || !blockHeader.equals(currentTask.blockHeader)) {
      currentTask = {nonce, targetDiff, blockHeader}
      currentNonce = 0
      console.log('Current task updated')
    }
  } else if (cmd.equals(SUSPEND)) {
    currentTask = null
    console.log('Mining suspended')
  } else if (cmd.equals(ACCEPTED)) {
    console.log('!!! ACCEPTED !!!')
  }
})
client.on('error', () => {
  console.log('Reconnecting')
  client.destroy()
  setTimeout(() => {
    client.connect(port, host)
  }, 1000)
})

const continueMining = () => {
  if (!currentTask) {
    setTimeout(() => {
      continueMining()
    }, 500)
    return
  }
  
  const header = Buffer.from(currentTask.blockHeader)
  blockSet(header, {
    nonceRaw: currentTask.nonce
  })
  let startTime = helperUnixTimeMs()
  let startNonce = currentNonce
  let found = false
  while (true) {
    let hash
    for (let i = 0; i < 1000; i++) {
      currentNonce = (currentNonce < 0xffffffffff ? currentNonce + 1 : 0)
      blockSet(header, {
        nonceLow: currentNonce
      })
      if (blockCalcHash(header, currentTask.targetDiff)) {
        found = true
        break
      }
    }
    const duration = helperUnixTimeMs() - startTime
    if (found || duration >= 500) {
      console.log('Mining at', parseInt((currentNonce - startNonce) * 1000 / duration), 'HPS')
      break
    }
  }
  if (found) {
    console.log('FOUND')
    client.write(Buffer.concat([BLOCK_FOUND, address, header]))
  }
  setTimeout(() => {
    continueMining()
  }, 1)
}
continueMining()

client.connect(port, host)
setInterval(() => {
  client.write(Buffer.concat([REQUEST_TASK, address]))
}, 1000)