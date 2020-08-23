import createStore from 'unistore'

import { setStore } from './storage'
import initState from './state'

export const store = createStore(initState)


store.subscribe(state => {
    console.info('%c State Changed ', 'color: yellow')
    console.log(state)
    setStore(state)
  })