import type { EventInfo, EventMap, OnHandlerOptions } from '../types';

/**
 * 転送先の指定\
 * 転送先のイベント名、または転送先のイベント名と detail の作り方\
 * イベント名だけの指定は、転送元の detail をそのまま転送先に渡せる場合に限る
 */
export type RelayTarget<
  S extends EventMap,
  T extends EventMap,
  K extends keyof S,
> = {
  [P in keyof T]:
    | ([S[K]] extends [T[P]] ? P : never)
    | {
        /**
         * 転送先のイベント名
         */
        type: P;

        /**
         * 転送元の detail から転送先の detail を作る
         */
        detail: (detail: S[K], event: EventInfo<S, K>) => T[P];
      };
}[keyof T];

/**
 * 転送元のイベント名ごとの転送先の指定
 */
export type RelayMap<S extends EventMap, T extends EventMap> = {
  readonly [K in keyof S]?: RelayTarget<S, T, K>;
};

/**
 * relay のオプション\
 * 転送元の on にそのまま渡す
 */
export type RelayOptions = Pick<OnHandlerOptions, 'owner' | 'signal'>;
