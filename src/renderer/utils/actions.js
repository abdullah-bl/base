
import { getStore } from './storage'

export const actions = {
    init(state) {
        let old = getStore()
        return {...state, ...old}
    }
}