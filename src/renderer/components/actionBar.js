import React from 'react'
import { Link, withRouter } from 'react-router-dom'
import { ArrowRight } from 'react-feather'

const ActionBar = ({ back, history, children }) => (
	<div className='action-bar'>
		{back && (
			<a onClick={history.goBack}>
				<span>للخلف</span>
				<ArrowRight />
			</a>
		)}
		{children}
	</div>
)

export default withRouter(ActionBar)
