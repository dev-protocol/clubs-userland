import { whenDefined } from '@devprotocol/util-ts'
import { T, always, cond } from 'ramda'

type ErrorOr<T> = Readonly<Error | T>
type NotError<T> = Exclude<T, Error>

const isNotError = <T>(v: T): v is NotError<T> =>
	v instanceof Error ? false : true
const passAll = <D>(depends: D): boolean =>
	depends instanceof Array ? depends.every(isNotError) : isNotError(depends)

export function whenNotErrorAll<D1, F>(
	depends: readonly [D1],
	fn: (d: readonly [NotError<D1>]) => F,
): ErrorOr<F>
export function whenNotErrorAll<D1, D2, F>(
	depends: readonly [D1, D2],
	fn: (d: readonly [NotError<D1>, NotError<D2>]) => F,
): ErrorOr<F>
export function whenNotErrorAll<D1, D2, D3, F>(
	depends: readonly [D1, D2, D3],
	fn: (d: readonly [NotError<D1>, NotError<D2>, NotError<D3>]) => F,
): ErrorOr<F>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function whenNotErrorAll(depends: unknown, fn: any): unknown {
	return whenDefined(
		depends,
		cond([
			[passAll, (deps) => fn(deps)],
			[
				T,
				always(
					depends instanceof Array
						? depends.find((d) => !isNotError(d))
						: depends,
				),
			],
		]),
	)
}
