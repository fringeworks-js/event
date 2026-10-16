import { throwErrors, toError } from '../_internal/errors';
import type {
  DetailArgs,
  EventDispatcherLike,
  EventDispatcherOptions,
  EventHandler,
  EventInfo,
  EventMap,
  OffHandlerOptions,
  OnHandlerOptions,
  SuspendMode,
  SyncFunction,
} from '../types';
import type { HandlerEntry, QueuedEvent } from './_types';

/**
 * イベントディスパッチャー\
 * 各メソッドの説明は EventDispatcherLike を参照
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
   * イベント名ごとの有効化の処理
   */
  private readonly _activators: EventDispatcherOptions<M>['activate'];

  /**
   * 有効になっているイベントの無効化の処理
   */
  private _deactivators = new Map<PropertyKey, () => void>();

  /**
   * @param options - 有効化の処理などのオプション
   */
  constructor(options?: EventDispatcherOptions<M>) {
    this._activators = options?.activate;
  }

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
      types: new Set(),
      cleanup: () => signal?.removeEventListener('abort', onAbort),
    };
    const off = () => {
      const errors: unknown[] = [];
      this._removeEntry(entry, errors);
      throwErrors(errors);
    };

    for (const t of toTypes(type)) {
      const handlers = this._handlers.get(t) ?? [];
      // 重複登録を防ぐ
      if (handlers.some((e) => e.handler === handler)) {
        continue;
      }
      // 有効化の処理の中で発火したイベントを受け取れるよう、登録してから有効化する
      this._handlers.set(t, [...handlers, entry]);
      entry.types.add(t);
      if (handlers.length > 0) {
        continue;
      }
      try {
        this._activate(t);
      } catch (error) {
        // 有効化に失敗した場合は、イベントの来ないハンドラーが残らないよう登録を取り消す
        const errors: unknown[] = [error];
        this._removeEntry(entry, errors);
        throw toError(errors);
      }
    }

    if (entry.types.size > 0) {
      signal?.addEventListener('abort', onAbort, { once: true });
    }
    return off;
  }

  off<K extends keyof M>(
    type: K | readonly K[],
    options?: OffHandlerOptions,
  ): void;
  off(options: OffHandlerOptions): void;
  off<K extends keyof M>(
    typeOrOptions: K | readonly K[] | OffHandlerOptions,
    options?: OffHandlerOptions,
  ): void {
    let types: readonly PropertyKey[];
    let match: ((entry: HandlerEntry) => boolean) | undefined;
    if (isOffHandlerOptions(typeOrOptions)) {
      // type 指定なし: 全イベントが対象
      types = [...this._handlers.keys()];
      match = toMatcher(typeOrOptions);
    } else {
      types = toTypes(typeOrOptions);
      match = options ? toMatcher(options) : () => true;
    }
    if (!match) {
      return;
    }
    const errors: unknown[] = [];
    for (const t of types) {
      this._removeEntries(t, match, errors);
    }
    throwErrors(errors);
  }

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

  hasHandlers(type: keyof M): boolean {
    return this._handlers.has(type);
  }

  suspend(mode: SuspendMode = 'ignore'): void {
    if (this._suspendCount === 0) {
      this._suspendMode = mode;
    }
    this._suspendCount++;
  }

  resume(): void {
    const errors: unknown[] = [];
    this._resume(errors);
    throwErrors(errors);
  }

  suspendDuring<R>(fn: SyncFunction<R>, mode?: SuspendMode): R {
    this.suspend(mode);
    let result: R;
    try {
      result = fn();
    } catch (error) {
      // 抑止の解除時のハンドラーの例外で、関数の例外が失われないようにする
      const errors: unknown[] = [error];
      this._resume(errors);
      throw toError(errors, 'The function and event handlers threw errors');
    }
    this.resume();
    return result;
  }

  /**
   * 全ハンドラーと溜めていたイベントを削除し、抑止を解除する\
   * 実行中の dispatch でも、残りのハンドラーは呼ばれなくなる\
   * 有効になっているイベントの無効化の処理もすべて呼ぶ
   */
  dispose(): void {
    const errors: unknown[] = [];
    for (const t of [...this._handlers.keys()]) {
      this._removeEntries(t, () => true, errors);
    }
    this._queue = [];
    this._suspendCount = 0;
    throwErrors(errors);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * 指定のイベントから条件に一致するハンドラーを削除する\
   * ハンドラーがなくなった場合は無効化の処理を呼び、その例外は errors に溜める
   */
  private _removeEntries(
    type: PropertyKey,
    match: (entry: HandlerEntry) => boolean,
    errors: unknown[],
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
      return;
    }
    this._handlers.delete(type);
    this._deactivate(type, errors);
  }

  /**
   * ハンドラーを登録されているすべてのイベントから削除する
   */
  private _removeEntry(entry: HandlerEntry, errors: unknown[]): void {
    for (const t of [...entry.types]) {
      this._removeEntries(t, (e) => e === entry, errors);
    }
  }

  /**
   * イベントの有効化の処理を呼び、無効化の処理を記録する
   */
  private _activate(type: PropertyKey): void {
    const activator = this._activators?.[type as keyof M];
    if (!activator) {
      return;
    }
    const deactivate = activator({
      type: type as keyof M,
      dispatch: this.dispatch.bind(this),
    });
    if (typeof deactivate !== 'function') {
      return;
    }
    // 有効化の処理の中で無効になった、または再び有効になった（記録済み）場合は、
    // この有効化は終わっているため、すぐに無効化する
    if (!this._handlers.has(type) || this._deactivators.has(type)) {
      deactivate();
      return;
    }
    this._deactivators.set(type, deactivate);
  }

  /**
   * イベントの無効化の処理を呼ぶ\
   * 例外は errors に溜める
   */
  private _deactivate(type: PropertyKey, errors: unknown[]): void {
    const deactivate = this._deactivators.get(type);
    if (!deactivate) {
      return;
    }
    this._deactivators.delete(type);
    try {
      deactivate();
    } catch (error) {
      errors.push(error);
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
   * 抑止を1段階解除し、完全に解除された場合は溜めていたイベントを発火する\
   * ハンドラーで発生した例外は errors に溜める
   */
  private _resume(errors: unknown[]): void {
    if (this._suspendCount === 0) {
      return;
    }
    this._suspendCount--;
    if (this._suspendCount > 0) {
      return;
    }
    // 発火中のハンドラーで suspend されても、取り出したイベントはすべて発火する
    const queue = this._queue;
    this._queue = [];
    for (const { type, detail } of queue) {
      this._invoke(type, detail, errors);
    }
  }

  /**
   * ハンドラーを実行する\
   * ハンドラー（と once による無効化の処理）で発生した例外は errors に溜め、残りのハンドラーの実行を続ける
   * @returns preventDefault が呼ばれなかった場合は true
   */
  private _invoke(
    type: PropertyKey,
    detail: unknown,
    errors: unknown[],
  ): boolean {
    const handlers = this._handlers.get(type);
    if (!handlers) {
      return true;
    }

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

    for (const entry of handlers) {
      if (stopped) {
        break;
      }
      // dispatch 中に削除されたハンドラーは呼ばない
      // once のハンドラーは呼ぶ前に削除されるため、再帰的な dispatch でも二重に呼ばれない
      if (!entry.types.has(type)) {
        continue;
      }
      if (entry.once) {
        this._removeEntry(entry, errors);
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
 * 削除オプションから削除対象の判定関数を作る\
 * handler も owner も null / undefined の場合は、意図しない削除を防ぐため undefined を返す
 */
function toMatcher(
  options: OffHandlerOptions,
): ((entry: HandlerEntry) => boolean) | undefined {
  const { handler, owner } = options;
  if (handler != null) {
    return (entry) => entry.handler === handler;
  }
  if (owner != null) {
    return (entry) => entry.owner === owner;
  }
  return undefined;
}
