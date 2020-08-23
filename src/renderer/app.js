import React from 'react'
import { Provider } from 'unistore/react'
import { HashRouter, Switch, Route } from 'react-router-dom'
import { store } from './utils'

import Home from './pages/home'
import Navbar from './components/navbar'

const App = () => (
	<Provider store={store}>
		<HashRouter>
			<Navbar />
			<Switch>
				<Route exact path='/' component={Home} />
			</Switch>
		</HashRouter>
	</Provider>
)

export default App
