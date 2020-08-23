const Store = window.require('electron-store')
const { remote } = window.require('electron')
const { is } = window.require('electron-util')
const { join } = window.require('path')

const store = new Store({
	name: 'store',
	fileExtension: '',
	cwd: is.development
		? remote.app.getAppPath()
		: join(remote.app.getPath('userData'), '/data'),
})

export const setStore = (args) => store.set(args)
export const getStore = () => store.get()
export const clearStore = () => {
	store.clear()
	location.reload()
}
