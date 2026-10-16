import { throwErrors, toError } from '../_internal/errors';
import type {
  EventDispatcherLike,
  EventMap,
  EventSubscribable,
} from '../types';
import type { RelayMap, RelayOptions } from './types';

/**
 * 転送元のイベントを、転送先のイベントとして発火し直す\
 * 転送先で preventDefault が呼ばれた場合は、転送元のイベントでも preventDefault を呼ぶ
 * @param source - 転送元
 * @param target - 転送先
 * @param map - 転送元のイベント名ごとの転送先の指定
 * @param options - 転送元の on に渡すオプション
 * @returns 転送をやめる関数
 */
export default function relay<S extends EventMap, T extends EventMap>(
  source: EventSubscribable<S>,
  target: EventDispatcherLike<T>,
  map: RelayMap<S, T>,
  options?: RelayOptions,
): () => void {
  const dispatch = target.dispatch.bind(target) as (
    type: PropertyKey,
    detail: unknown,
  ) => boolean;
  const offs: (() => void)[] = [];
  const off = () => {
    const errors: unknown[] = [];
    for (const f of offs.splice(0)) {
      try {
        f();
      } catch (error) {
        errors.push(error);
      }
    }
    throwErrors(errors);
  };

  for (const type of Reflect.ownKeys(map) as (keyof S)[]) {
    const relayTarget = map[type];
    if (relayTarget == null) {
      continue;
    }
    const { type: targetType, detail: createDetail } =
      typeof relayTarget === 'object'
        ? relayTarget
        : { type: relayTarget, detail: undefined };
    try {
      offs.push(
        source.on(
          type,
          (event) => {
            const detail = createDetail
              ? createDetail(event.detail, event)
              : event.detail;
            if (!dispatch(targetType, detail)) {
              event.preventDefault();
            }
          },
          options,
        ),
      );
    } catch (error) {
      // 一部だけ転送される状態にならないよう、登録済みの転送をやめる
      const errors: unknown[] = [error];
      try {
        off();
      } catch (offError) {
        errors.push(offError);
      }
      throw toError(errors);
    }
  }
  return off;
}
