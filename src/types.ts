/**
 * イベントマップの基本型\
 * キーがイベント名、値が detail の型（detail のないイベントは void）
 */
export type EventMap = Record<string, any>;

/**
 * イベントの情報\
 * K にユニオン型を指定するとイベント名ごとに分配され、type で detail の型を絞り込める
 */
export type EventInfo<
  M extends EventMap = EventMap,
  K extends keyof M = keyof M,
> = {
  // 条件型ではなくマップ型で分配することで、親子間でイベントマップが異なる dispatcher を代入できるようにしている
  [P in K]: {
    /**
     * イベント名
     */
    readonly type: P;

    /**
     * イベント発火時に設定されたデータ
     */
    readonly detail: M[P];

    /**
     * preventDefault が呼ばれたかどうか
     */
    readonly defaultPrevented: boolean;

    /**
     * イベントをキャンセルする\
     * dispatch の戻り値が false になる
     */
    preventDefault(): void;

    /**
     * 残りのハンドラーを実行しないようにする
     */
    stopImmediatePropagation(): void;
  };
}[K];

/**
 * イベントハンドラー
 */
export type EventHandler<
  M extends EventMap = EventMap,
  K extends keyof M = keyof M,
> = (event: EventInfo<M, K>) => void;

/**
 * dispatch に渡す detail の引数\
 * detail が void（または unknown）のイベントは省略できる
 */
export type DetailArgs<P> = [P] extends [void]
  ? [detail?: P]
  : unknown extends P
    ? [detail?: P]
    : [detail: P];

/**
 * ハンドラー追加時のオプション
 */
export type OnHandlerOptions = {
  /**
   * イベントハンドラーのオーナー\
   * off({ owner }) でオーナー単位にまとめて削除できる
   */
  owner?: any;

  /**
   * true の場合、一度呼ばれたら自動で削除される\
   * 複数のイベント名を指定した場合は、いずれかで一度呼ばれた時点ですべて削除される
   */
  once?: boolean;

  /**
   * abort されるとハンドラーが削除される
   */
  signal?: AbortSignal;
};

/**
 * ハンドラー削除時のオプション\
 * ハンドラーを指定して削除する場合はhandlerを、\
 * オーナーを指定して削除する場合はownerを指定する（両方の指定は不可）\
 * 指定した値が null / undefined の場合は何も削除しない
 */
export type OffHandlerOptions =
  | {
      /**
       * 削除対象のハンドラー
       */
      handler: EventHandler<any, any>;

      owner?: never;
    }
  | {
      /**
       * 削除対象のハンドラーのオーナー
       */
      owner: any;
      handler?: never;
    };

/**
 * 有効化の処理に渡される情報
 */
export type EventActivatorContext<
  M extends EventMap = EventMap,
  K extends keyof M = keyof M,
> = {
  /**
   * 有効になったイベント名
   */
  readonly type: K;

  /**
   * イベントを発火する（EventDispatcher の dispatch と同じ）
   */
  readonly dispatch: <P extends keyof M>(
    type: P,
    ...args: DetailArgs<M[P]>
  ) => boolean;
};

/**
 * イベントの有効化の処理\
 * イベントの最初のハンドラーが登録されたときに呼ばれる\
 * 関数を返すと、最後のハンドラーが削除されたときに呼ばれる
 */
export type EventActivator<
  M extends EventMap = EventMap,
  K extends keyof M = keyof M,
> = (context: EventActivatorContext<M, K>) => (() => void) | void;

/**
 * EventDispatcher のオプション
 */
export type EventDispatcherOptions<M extends EventMap = EventMap> = {
  /**
   * イベント名ごとの有効化の処理\
   * ハンドラーが登録されているあいだだけ、イベントの元になる処理（DOM のリスナーなど）を動かす場合に使う
   */
  activate?: { readonly [K in keyof M]?: EventActivator<M, K> };
};

/**
 * 抑止中に発火されたイベントの扱い
 *
 * - `ignore` - 無視する（捨てる）
 * - `queue` - すべて溜めておき、抑止の解除後に発火順に発火する
 * - `latest` - イベント名ごとに最後の1件だけ溜めておき、抑止の解除後に発火する
 */
export type SuspendMode = 'ignore' | 'queue' | 'latest';

/**
 * 同期的に実行される関数\
 * Promise を返す関数は型エラーになる
 */
export type SyncFunction<R> = () => R &
  ([R] extends [PromiseLike<unknown>] ? never : unknown);

/**
 * イベントを購読する側のインターフェイス\
 * 外部に公開して、ハンドラーの登録と削除だけを許可する場合に使う
 */
export interface EventSubscribable<M extends EventMap = EventMap> {
  /**
   * イベントハンドラーを登録する\
   * 同一イベントへの同一ハンドラーの重複登録は無視される\
   * 実行中の dispatch で登録したハンドラーは、その dispatch では呼ばれない
   * @param type - イベント名。配列で複数指定できる
   * @returns ハンドラーを削除する関数
   */
  on<K extends keyof M>(
    type: K | readonly K[],
    handler: EventHandler<M, K>,
    options?: OnHandlerOptions,
  ): () => void;

  /**
   * イベントハンドラーを削除する\
   * 実行中の dispatch で削除したハンドラーは、その dispatch でも以降は呼ばれない
   * @param type - イベント名。配列で複数指定できる。省略した場合は全イベントが対象になる
   * @param options - handler を指定するとそのハンドラーのみ、owner を指定するとそのオーナーのハンドラーを削除。省略した場合はすべて削除
   */
  off<K extends keyof M>(
    type: K | readonly K[],
    options?: OffHandlerOptions,
  ): void;
  off(options: OffHandlerOptions): void;
}

/**
 * イベントを発火する側のインターフェイス\
 * インスタンスを共有する子に渡す場合に使う。破棄はインスタンスを作った側だけが行うため、dispose は含まない
 */
export interface EventDispatcherLike<
  M extends EventMap = EventMap,
> extends EventSubscribable<M> {
  /**
   * イベントを発火する
   * @returns いずれかのハンドラーで preventDefault が呼ばれた場合は false（抑止中は常に true）
   */
  dispatch<K extends keyof M>(type: K, ...args: DetailArgs<M[K]>): boolean;

  /**
   * イベントにハンドラーが登録されているかどうかを返す\
   * detail の生成に手間がかかる場合に、発火を省くために使う
   */
  hasHandlers(type: keyof M): boolean;

  /**
   * イベントの発火を抑止する\
   * 入れ子で呼んだ場合は同じ回数 resume するまで抑止が続き、mode は一番外側の指定に従う
   * @param mode - 抑止中に発火されたイベントの扱い（デフォルトは ignore）
   */
  suspend(mode?: SuspendMode): void;

  /**
   * イベントの発火抑止を解除する\
   * 抑止が完全に解除された時点で、溜めていたイベントを溜めた順に発火する\
   * 発火中のハンドラーで dispatch したイベントは、残りの溜めていたイベントより先に発火される\
   * 発火中のハンドラーで suspend を呼んでも、溜めていたイベントはすべて発火される
   */
  resume(): void;

  /**
   * 関数の実行中だけイベントの発火を抑止する\
   * 関数は同期的に実行され、例外が発生しても抑止は解除される\
   * 関数の例外に加えて抑止の解除時にハンドラーでも例外が発生した場合は、関数の例外を先頭にして AggregateError にまとめる
   * @returns 関数の戻り値
   */
  suspendDuring<R>(fn: SyncFunction<R>, mode?: SuspendMode): R;
}

/**
 * イベントを購読できるクラスのインターフェイス
 */
export interface Evented<M extends EventMap = EventMap> {
  readonly events: EventSubscribable<M>;
}
