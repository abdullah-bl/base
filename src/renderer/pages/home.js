import React from 'react'
import { Activity } from 'react-feather'
import ActionBar from '../components/actionBar'

const Home = () => (
	<>
		<main>
			<div>home</div>
		</main>
		<ActionBar back>
			<a>
				<span>Hello</span>
				<Activity />
			</a>
		</ActionBar>
	</>
)

export default Home
