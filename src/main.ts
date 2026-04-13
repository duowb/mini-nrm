import cp from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { cwd, platform } from 'node:process'
import customRegistries from '../custom_registries.json'
import registries from '../registries.json'

const isWin = platform === 'win32'
const NPM = isWin ? 'npm.cmd' : 'npm'
let registriesAll = Object.assign({}, registries, customRegistries)

const NPMRC_PATH = join(homedir(), '.npmrc')

let current: string
const maxCharWidth =
  Math.max(...Object.keys(registriesAll).map((key) => key.length)) + 3

/**
 * @param {string} str Render colors for "str"
 */
export const logger = {
  red(str: string) {
    return `\u001B[31m${str}\u001B[39m`
  },
  green(str: string) {
    return `\u001B[32m${str}\u001B[39m`
  },
  yellow(str: string) {
    return `\u001B[33m${str}\u001B[39m`
  },
}

function getCurrentRegistry(): string {
  if (!existsSync(NPMRC_PATH)) return 'https://registry.npmjs.org/'
  const content = readFileSync(NPMRC_PATH, 'utf8')
  const match = content.match(/^registry\s*=\s*([^\s#].*)$/m)
  if (!match) return 'https://registry.npmjs.org/'
  const registry = match[1].trim()
  // 确保不以空格或 # 开头
  return registry && !registry.startsWith('#')
    ? registry
    : 'https://registry.npmjs.org/'
}

function setRegistry(url: string): void {
  let content = existsSync(NPMRC_PATH) ? readFileSync(NPMRC_PATH, 'utf8') : ''
  if (/^registry\s*=/m.test(content)) {
    content = content.replace(/^registry\s*=.+$/m, `registry=${url}`)
  } else {
    content = `${content.trimEnd()}\nregistry=${url}\n`.trimStart()
  }
  writeFileSync(NPMRC_PATH, content, 'utf8')
}

function isHttp(str: string) {
  return /^https?:\/\//.test(str)
}

function saveRegistries() {
  registriesAll = Object.assign({}, registries, customRegistries)
  writeFileSync(
    join(__dirname, '../custom_registries.json'),
    JSON.stringify(customRegistries, null, 2),
  )
}

type RegistryTiming = {
  code: string
  total: number
  DNS: number
  TCP: number
  start_transfer: number
  effective: string
}

function pingRegistry(url: string): Promise<RegistryTiming> {
  return new Promise((resolve) => {
    const start = Date.now()
    let dnsTime = 0
    let tcpTime = 0

    const req = (url.startsWith('https:') ? https : http).get(
      url,
      { timeout: 5000 },
      (res) => {
        const ttfb = Date.now() - start
        res.destroy()
        resolve({
          code: String(res.statusCode ?? 0),
          total: Date.now() - start,
          DNS: dnsTime,
          TCP: tcpTime,
          start_transfer: ttfb,
          effective: url,
        })
      },
    )

    req.on('socket', (socket) => {
      socket.on('lookup', () => {
        dnsTime = Date.now() - start
      })
      socket.on('connect', () => {
        tcpTime = Date.now() - start
      })
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({
        code: '000',
        total: 5000,
        DNS: dnsTime,
        TCP: tcpTime,
        start_transfer: 0,
        effective: url,
      })
    })

    req.on('error', () => {
      resolve({
        code: '000',
        total: Date.now() - start,
        DNS: dnsTime,
        TCP: tcpTime,
        start_transfer: 0,
        effective: url,
      })
    })
  })
}

export function list() {
  let output = ''
  if (!current) current = getCurrentRegistry()

  for (const [k, v] of Object.entries(registriesAll)) {
    const isCurrent = v.registry === current
    const ph = Array.from({
      length: Math.max(maxCharWidth - k.length + 1),
    }).join('-')
    const registry = `${isCurrent ? '*' : ' '} ${k} ${ph} ${v.registry}\n`
    output += isCurrent ? logger.green(registry) : registry
  }

  return output.trimEnd()
}

export function use(name: string, argv: string[] = []) {
  const registry = (registriesAll as any)[name as string]
  if (Array.isArray(argv) && argv.length) {
    if (!registry) {
      const registrys = Object.keys(registriesAll).map(logger.yellow).join(', ')
      return `  Available registry: ${registrys}`
    }

    argv.unshift('install')
    argv.push('--registry', registry.registry)
    const child = cp.spawn(NPM, argv, {
      cwd: cwd(),
      stdio: 'inherit',
      shell: isWin,
    })

    child.on('error', () => {
      console.error(logger.red('  Failed to run npm install'))
    })

    return ''
  }
  if (registry) {
    current = registry.registry
    setRegistry(current)
    return list()
  }

  const registrys = Object.keys(registriesAll).map(logger.yellow).join(', ')
  return `  Available registry: ${registrys}`
}

export function add(name: string, registry: string, home?: string) {
  if (name && registry && isHttp(registry)) {
    // Must end with "/"
    if (!registry.endsWith('/')) registry = `${registry}/`
    // If a custom added registry is already in place, it will not be added and will warn
    const isExists = Object.entries(registriesAll).some(
      (item) => item[1].registry === registry,
    )
    if (isExists) {
      const warn = logger.yellow(registry)
      return `  The ${warn} you specified already exists, please do not add the same registry again and again`
    }

    ;(customRegistries as any)[name] = { home, registry }
    saveRegistries()
    return list()
  }

  const example = logger.yellow(
    '"mnrm add npm https://registry.npmjs.org/ https://www.npmjs.org"',
  )
  return `  mnrm add <name> <registry> [home]\n  Example: ${example}`
}

export function test(info?: string, onResult?: (result: unknown) => void) {
  const TIMEOUT = 'Timeout'
  const isInfo = ['-i', '--info'].includes(info as string)
  if (!current) current = getCurrentRegistry()

  const promises = Object.keys(registriesAll).map(async (key) => {
    const registry = (registriesAll as any)[key].registry
    const isCurrent = registry === current
    const ph = Array.from({
      length: Math.max(maxCharWidth - key.length + 1),
    }).join('-')

    const timing = await pingRegistry(registry)
    const isTimeout = timing.code === '000' || timing.total >= 5000
    const msg = isTimeout ? TIMEOUT : `${timing.total} ms`

    let color: string
    if (isTimeout) color = logger.red(TIMEOUT)
    else if (timing.total < 500) color = logger.green(msg)
    else if (timing.total < 1000) color = logger.yellow(msg)
    else color = logger.red(msg)

    let result: unknown
    if (isInfo) {
      result = {
        name: key,
        code: timing.code,
        total: isTimeout ? TIMEOUT : `${timing.total}ms`,
        DNS: `${timing.DNS}ms`,
        TCP: `${timing.TCP}ms`,
        start_transfer: `${timing.start_transfer}ms`,
        redirect: '0ms',
        effective: timing.effective,
      }
    } else {
      const prefix = `${key} ${ph}`
      const currentColor = isCurrent
        ? logger.green(`* ${prefix}`)
        : `  ${prefix}`
      result = `${currentColor} ${color}`
    }

    onResult?.(result)
    return result
  })

  return Promise.all(promises).then((data) =>
    isInfo ? data : (data as string[]).join('\n'),
  )
}

export function remove(...args: string[]) {
  let isRemove

  for (const arg of args) {
    const existsRegistry = (customRegistries as any)[arg]
    if (existsRegistry) {
      isRemove = true

      delete (customRegistries as any)[arg]
    }
  }

  if (isRemove) {
    saveRegistries()
    return list()
  }

  const names = Object.keys(customRegistries).map(logger.yellow).join(', ')
  if (names) return `  Available registry for deletion: ${names}`

  return logger.yellow('  There are no more registries that can be deleted')
}

export function help() {
  return `
  Usage
    $ mnrm [options]
  Options
    ls, list                            List all the registries
    use <name> [package...]             Switch registry or specify registry directly to install npm packages
    add <name> <registry> [home]        Add a custom registry
    test [-i, --info]                   Test the response time of all registries
    del, delete, rm, remove <name...>   Remove a custom registry
    h, -h, help, --help                 Show this help
  Examples
  
    $ ${logger.yellow('mnrm add npm https://registry.npmjs.org/')}

    $ ${logger.yellow('mnrm use npm')}

    $ ${logger.yellow('mnrm use taobao output-line get-user-ip body-data simple-unique -S')}

    $ ${logger.yellow('mnrm list')}

      ${logger.green('* npm --------- https://registry.npmjs.org/')}
        yarn -------- https://registry.yarnpkg.com/
        taobao ------ https://registry.npmmirror.com/
        tencent ----- https://mirrors.cloud.tencent.com/npm/
        npmMirror --- https://skimdb.npmjs.com/registry/
    
    $ ${logger.yellow('mnrm test')}

      ${logger.green(`* npm --------- ${logger.green('153 ms')}`)}
        yarn -------- ${logger.green('175 ms')}
        taobao ------ ${logger.yellow('519 ms')}
        tencent ----- ${logger.green('121 ms')}
        npmMirror --- ${logger.green('481 ms')}
`
}
