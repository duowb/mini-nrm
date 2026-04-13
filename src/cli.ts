#!/usr/bin/env node
import { argv } from 'node:process'
import packageJson from '../package.json'
import { add, help, list, remove, test, use } from './main'

const [cmd, ...args] = argv.slice(2)

switch (cmd) {
  case 'ls':
  case 'list':
    console.log(list())
    break
  case 'use':
    console.log(use(args.shift() || '', args))
    break
  case 'add':
    console.log(add(args[0], args[1], args[2]))
    break
  case 'test': {
    const info = args[0]
    const log = ['-i', '--info'].includes(info) ? console.table : console.log
    test(info, log)
    break
  }
  case 'del':
  case 'delete':
  case 'rm':
  case 'remove':
    console.log(remove(...args))
    break
  case '-v':
  case '--version':
    console.log(`v${packageJson.version}`)
    break
  case 'h':
  case '-h':
  case 'help':
  case '--help':
    console.log(help())
    break
  default:
    console.log(help())
    break
}
