import test from 'ava'
import example from './index.js'

test('exports undefined', (t) => {
	t.is(example, undefined)
})
