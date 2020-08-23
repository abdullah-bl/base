
import React from 'react'
import ReactDom from 'react-dom'
import App from './app'

import './style/index.sass'
import './style/tachyons.min.css'

ReactDom.render(
    <App />,
    document.getElementById('app')
)

if (module.hot) {
    module.hot.accept()
}