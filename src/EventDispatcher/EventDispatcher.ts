import type {
  DetailArgs,
  EventDispatcherLike,
  EventHandler,
  EventInfo,
  EventMap,
  OffHandlerOptions,
  OnHandlerOptions,
  SuspendMode,
} from '../types';
import type { HandlerEntry, QueuedEvent } from './types';

/**
 * イベントディスパッチャー
 */
export default class EventDispatcher<M extends EventMap = EventMap>
  implements EventDispatcherLike<M>, Disposable
{
  /**
   * イベントハンドラー\
   * dispatch 中の on/off の影響を受けないよう、配列は変更せずに差し替える
   */
  private _handlers = new Map<PropertyKey, HandlerEntry[]>();

  /**
   * イベントの抑止階層数
   */
  private _suspendCount: number = 0;

  /**
   * 抑止中に発火されたイベントの扱い
   */
  private _suspendMode: SuspendMode = 'ignore';

  /**
   * 抑止中に溜めているイベント
   */
  private _queue: QueuedEvent[] = [];

  /**
   * イベントハンドラーを登録する\
   * 同一イベントへの同一ハンドラーの重複登録は無視される
   * @param type - イベント名。配列で複数指定できる
   * @returns ハンドラーを削除する関数
   */
  on<K extends keyof M>(
    type: K | readonly K[],
    handler: EventHandler<M, K>,
    options?: OnHandlerOptions,
  ): () => void {
    const { owner, once = false, signal } = options ?? {};
    if (signal?.aborted) {
      return () => {};
    }

    const onAbort = () => off();
    const entry: HandlerEntry = {
      handler,
      owner,
      once,
      fired: false,
      types: new Set(),
      cleanup: () => signal?.removeEventListener('abort', onAbort),
    };
    const off = () => {
      for (const t of [...entry.types]) {
        this._removeEntries(t, (e) => e === entry);
      }
    };

    for (const t of toTypes(type)) {
      const handlers = this._handlers.get(t) ?? [];
      // 重複登録を防ぐ
      if (handlers.some((e) => e.handler === handler)) {
        continue;
      }
      this._handlers.set(t, [...handlers, entry]);
      entry.types.add(t);
    }

    if (entry.types.size > 0) {
      signal?.addEventListener('abort', onAbort, { once: true });
    }
    return off;
  }

  /**
   * イベントハンドラーを削除する
   * @param type - イベント名。配列で複数指定できる。省略した場合は全イベントが対象になる
   * @param options - handler を指定するとそのハンドラーのみ、owner を指定するとそのオーナーのハンドラーを削除。省略した場合はすべて削除
   */
  off<K extends keyof M>(
    type: K | readonly K[],
    options?: OffHandlerOptions,
  ): void;
  off(options: OffHandlerOptions): void;
  off<K extends keyof M>(
    typeOrOptions: K | readonly K[] | OffHandlerOptions,
    options?: OffHandlerOptions,
  ): void {
    if (isOffHandlerOptions(typeOrOptions)) {
      // type 指定なし: 全イベントが対象
      const match = toMatcher(typeOrOptions);
      for (const t of [...this._handlers.keys()]) {
        this._removeEntries(t, match);
      }
      return;
    }
    const match = options ? toMatcher(options) : () => true;
    for (const t of toTypes(typeOrOptions)) {
      this._removeEntries(t, match);
    }
  }

  /**
   * イベントを発火する
   * @returns いずれかのハンドラーで preventDefault が呼ばれた場合は false（抑止中は常に true）
   */
  dispatch<K extends keyof M>(type: K, ...args: DetailArgs<M[K]>): boolean {
    const [detail] = args;
    if (this._suspendCount > 0) {
      this._enqueue(type, detail);
      return true;
    }
    const errors: unknown[] = [];
    const result = this._invoke(type, detail, errors);
    throwErrors(errors);
    return result;
  }

  /**
   * イベントの発火を抑止する\
   * 入れ子で呼んだ場合は同じ回数 resume するまで抑止が続き、mode は一番外側の指定に従う
   * @param mode - 抑止中に発火されたイベントの扱い（デフォルトは ignore）
   */
  suspend(mode: SuspendMode = 'ignore'): void {
    if (this._suspendCount === 0) {
      this._suspendMode = mode;
    }
    this._suspendCount++;
  }

  /**
   * イベントの発火抑止を解除する\
   * 抑止が完全に解除された時点で、溜めていたイベントを発火する
   */
  resume(): void {
    if (this._suspendCount === 0) {
      return;
    }
    this._suspendCount--;
    if (this._suspendCount > 0) {
      return;
    }
    const queue = this._queue;
    this._queue = [];
    const errors: unknown[] = [];
    for (const { type, detail } of queue) {
      this._invoke(type, detail, errors);
    }
    throwErrors(errors);
  }

  /**
   * 関数の実行中だけイベントの発火を抑止する\
   * 関数は同期的に実行され、例外が発生しても抑止は解除される\
   * Promise を返す関数は型エラーになる（非同期の処理では suspend と resume を使う）
   * @returns 関数の戻り値
   */
  suspendDuring<R>(
    fn: () => R & ([R] extends [PromiseLike<unknown>] ? never : unknown),
    mode?: SuspendMode,
  ): R {
    this.suspend(mode);
    try {
      return fn();
    } finally {
      this.resume();
    }
  }

  /**
   * 全ハンドラーと溜めていたイベントを削除し、抑止を解除する
   */
  dispose(): void {
    for (const t of [...this._handlers.keys()]) {
      this._removeEntries(t, () => true);
    }
    this._queue = [];
    this._suspendCount = 0;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * 指定のイベントから条件に一致するハンドラーを削除する
   */
  private _removeEntries(
    type: PropertyKey,
    match: (entry: HandlerEntry) => boolean,
  ): void {
    const handlers = this._handlers.get(type);
    if (!handlers) {
      return;
    }
    const rest: HandlerEntry[] = [];
    for (const entry of handlers) {
      if (!match(entry)) {
        rest.push(entry);
        continue;
      }
      entry.types.delete(type);
      if (entry.types.size === 0) {
        entry.cleanup();
      }
    }
    if (rest.length > 0) {
      this._handlers.set(type, rest);
    } else {
      this._handlers.delete(type);
    }
  }

  /**
   * 抑止中に発火されたイベントを溜める
   */
  private _enqueue(type: PropertyKey, detail: unknown): void {
    switch (this._suspendMode) {
      case 'queue':
        this._queue.push({ type, detail });
        break;
      case 'latest':
        this._queue = this._queue.filter((q) => q.type !== type);
        this._queue.push({ type, detail });
        break;
    }
  }

  /**
   * ハンドラーを実行する\
   * ハンドラーで発生した例外は errors に溜め、残りのハンドラーの実行を続ける
   * @returns preventDefault が呼ばれなかった場合は true
   */
  private _invoke(
    type: PropertyKey,
    detail: unknown,
    errors: unknown[],
  ): boolean {
    let defaultPrevented = false;
    let stopped = false;
    const event = {
      type,
      detail,
      get defaultPrevented() {
        return defaultPrevented;
      },
      preventDefault() {
        defaultPrevented = true;
      },
      stopImmediatePropagation() {
        stopped = true;
      },
    } as unknown as EventInfo<M>;

    for (const entry of this._handlers.get(type) ?? []) {
      if (stopped) {
        break;
      }
      if (entry.once) {
        // 同じ dispatch 中や再帰的な dispatch で二重に呼ばれないようにする
        if (entry.fired) {
          continue;
        }
        entry.fired = true;
        for (const t of [...entry.types]) {
          this._removeEntries(t, (e) => e === entry);
        }
      }
      try {
        entry.handler(event);
      } catch (error) {
        errors.push(error);
      }
    }
    return !defaultPrevented;
  }
}

/**
 * イベント名の指定を配列に揃える
 */
function toTypes<K>(type: K | readonly K[]): readonly K[] {
  return Array.isArray(type) ? type : [type as K];
}

function isOffHandlerOptions(value: unknown): value is OffHandlerOptions {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 削除オプションから削除対象の判定関数を作る
 */
function toMatcher(
  options: OffHandlerOptions,
): (entry: HandlerEntry) => boolean {
  const { handler, owner } = options;
  return handler != null
    ? (entry) => entry.handler === handler
    : (entry) => entry.owner === owner;
}

/**
 * 溜めていた例外を投げる\
 * 1件ならそのまま、複数なら AggregateError にまとめて投げる
 */
function throwErrors(errors: unknown[]): void {
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Multiple event handlers threw errors');
  }
}
