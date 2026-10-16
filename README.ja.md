# @fringeworks/event

`@fringeworks/event` はシンプルなイベント処理のための、誰かにとっては便利なライブラリです。\
型安全なイベントの登録・発火に加えて、インスタンスの親子間での共有、イベントの抑止とまとめての発火、キャンセル可能なイベントを提供します。

**[English README is available here](./README.md)**

## 特徴

- 型安全: イベント名ごとに detail の型が決まり、複数のイベントをまとめて購読しても `type` で型を絞り込めます。
- インスタンスの共有: 親が持つ `EventDispatcher` を子に渡すだけで、子のイベントを親の購読者が受け取れます。外部には購読だけを許す型で公開できます。
- 転送: 子のイベントを、親の別のイベントとして転送できます（`relay`）。
- 抑止: イベントの発火を一時的に止め、抑止中のイベントを無視する・すべて発火する・最後の1件だけ発火するから選べます。
- キャンセル: ハンドラーで `preventDefault()` を呼ぶと `dispatch` が `false` を返します。
- 有効化: 購読されているあいだだけ、イベントの元になる処理（DOM のリスナーなど）を動かせます。
- 標準 API との親和性: `AbortSignal` による解除と、`using` 構文による破棄に対応しています。

## インストール

```sh
npm install @fringeworks/event
```

TypeScript で使う場合は 5.2 以上が必要です。\
`using` 構文による破棄には、`Symbol.dispose` のある実行環境またはポリフィルが必要です。`dispose()` を直接呼ぶ場合は不要です。

## 使い方

### イベントの登録と発火

イベントマップ（イベント名と detail の型の対応）を型引数に指定します。detail のないイベントは `void` にします。

```ts
import { EventDispatcher } from '@fringeworks/event';

type TodoEvents = {
  add: { title: string };
  remove: { id: number };
  clear: void;
};

const events = new EventDispatcher<TodoEvents>();

const off = events.on('add', (event) => {
  console.log(event.type, event.detail.title);
});

events.dispatch('add', { title: 'Buy milk' });
events.dispatch('clear'); // detail が void のイベントは省略できる

off(); // ハンドラーを削除
```

### 複数のイベントをまとめて購読

```ts
events.on(['add', 'remove'], (event) => {
  if (event.type === 'add') {
    event.detail.title; // { title: string }
  } else {
    event.detail.id; // { id: number }
  }
});
```

### ハンドラーの削除

`on` の戻り値の関数を呼ぶ方法のほかに、次の方法でも削除できます。

```ts
// ハンドラーを指定して削除
events.off('add', { handler });

// オーナー単位でまとめて削除
events.on('add', handler, { owner: this });
events.on('remove', handler2, { owner: this });
events.off({ owner: this }); // 全イベントから this のハンドラーを削除

// イベントのハンドラーをすべて削除
events.off('add');

// AbortSignal で削除
const controller = new AbortController();
events.on('add', handler, { signal: controller.signal });
controller.abort();

// 一度だけ呼ぶ
events.on('add', handler, { once: true });
```

`off` の `handler` や `owner` に指定した値が `null` / `undefined` の場合は、何も削除しません。

`dispatch` の実行中にハンドラーを削除した場合は、その `dispatch` でも削除したハンドラーは呼ばれません（`dispose` も同じです）。実行中に登録したハンドラーは、次の `dispatch` から呼ばれます。

### イベントのキャンセル

```ts
type FormEvents = {
  beforeSubmit: { values: Record<string, string> };
};

const events = new EventDispatcher<FormEvents>();

events.on('beforeSubmit', (event) => {
  if (!event.detail.values.name) {
    event.preventDefault();
  }
});

if (events.dispatch('beforeSubmit', { values })) {
  submit(values);
}
```

`event.stopImmediatePropagation()` を呼ぶと、残りのハンドラーは実行されません。

### イベントの抑止

`suspend` から `resume` までの間に発火されたイベントの扱いを、モードで指定します。

| モード             | 抑止中のイベントの扱い                                          |
| ------------------ | --------------------------------------------------------------- |
| `ignore`（既定値） | 無視する（捨てる）                                              |
| `queue`            | すべて溜めておき、抑止の解除後に発火順に発火する                |
| `latest`           | イベント名ごとに最後の1件だけ溜めておき、抑止の解除後に発火する |

```ts
events.suspend('latest');
events.dispatch('add', { title: 'A' });
events.dispatch('add', { title: 'B' });
events.resume(); // add は { title: 'B' } で1回だけ発火する
```

`latest` では、イベント名ごとに最後に `dispatch` された順に発火します。たとえば `add` → `remove` → `add` の順に発火した場合、抑止の解除後は `remove` → `add` の順になります。

溜めていたイベントの発火中に、ハンドラーで `dispatch` したイベントは、残りの溜めていたイベントより先に発火します。ハンドラーで `suspend` を呼んでも、溜めていたイベントはすべて発火します（その後の `dispatch` は抑止されます）。

`suspendDuring` を使うと、関数の実行中だけ抑止できます。関数で例外が発生しても抑止は解除されます。

```ts
events.suspendDuring(() => {
  items.forEach((item) => collection.add(item));
}, 'latest');
```

`suspendDuring` に渡せるのは同期的な関数だけで、Promise を返す関数は型エラーになります。非同期の処理の間だけ抑止したい場合は、`suspend` と `resume` を `try` / `finally` で囲んで使います。

```ts
events.suspend('latest');
try {
  await saveAll(items);
} finally {
  events.resume();
}
```

`suspend` を入れ子で呼んだ場合は、同じ回数 `resume` するまで抑止が続き、モードは一番外側の指定に従います。

### 親子でのインスタンスの共有

親が持つ `EventDispatcher` を子に渡すと、子が発火したイベントを親の購読者がそのまま受け取れます。\
子は自分が発火するイベントだけを型として宣言し、親はそれより多くのイベントを持つインスタンスを渡せます。

用途に合わせて、次の型を使い分けます。

| 型                       | できること                               | 使う場所                       |
| ------------------------ | ---------------------------------------- | ------------------------------ |
| `EventSubscribable<M>`   | 購読（`on` / `off`）                     | 外部に公開する `events`        |
| `EventDispatcherLike<M>` | 購読と発火・抑止（`dispose` は含まない） | 子が受け取るインスタンスの型   |
| `EventDispatcher<M>`     | すべて（`dispose` を含む）               | インスタンスを作った側だけ持つ |

```ts
import {
  EventDispatcher,
  type EventDispatcherLike,
  type EventSubscribable,
  type Evented,
} from '@fringeworks/event';

type ToolbarEvents = {
  click: { button: string };
};

type GridEvents = ToolbarEvents & {
  select: { row: number };
};

class Toolbar implements Evented<ToolbarEvents> {
  readonly events: EventSubscribable<ToolbarEvents>;
  private readonly dispatcher: EventDispatcherLike<ToolbarEvents>;

  constructor(dispatcher: EventDispatcherLike<ToolbarEvents>) {
    this.dispatcher = dispatcher;
    this.events = dispatcher;
  }

  click(button: string) {
    this.dispatcher.dispatch('click', { button });
  }
}

class Grid implements Evented<GridEvents> {
  private readonly dispatcher = new EventDispatcher<GridEvents>();
  readonly events: EventSubscribable<GridEvents> = this.dispatcher;
  readonly toolbar = new Toolbar(this.dispatcher);

  dispose() {
    this.dispatcher.dispose();
  }
}

const grid = new Grid();
grid.events.on('click', (event) => console.log(event.detail.button));
// grid.events.dispatch(...) や grid.events.dispose() は型エラーになる
```

受け取った側（`Toolbar`）は `dispose` を呼べないため、親や他の子の購読を誤ってすべて削除することはありません。\
受け取った側が自分の登録したハンドラーだけを削除したい場合は、登録時に `owner` を指定して `off({ owner: this })` を使います。

### 子のイベントを親のイベントとして転送する

親と子がそれぞれ `EventDispatcher` を持ち、同じ名前のイベント（例: 両方の `change`）を区別したい場合は、インスタンスを共有せずに `relay` で子のイベントを親の別のイベントとして転送します。\
転送するときに detail を作り直せるので、どの子のイベントかを detail に加えられます。

```ts
import {
  EventDispatcher,
  relay,
  type EventSubscribable,
  type Evented,
} from '@fringeworks/event';

type FieldEvents = {
  change: { value: string };
};

type RecordEvents = {
  change: { values: Record<string, string> };
  fieldChange: { field: DataField; value: string };
};

class DataField implements Evented<FieldEvents> {
  private readonly dispatcher = new EventDispatcher<FieldEvents>();
  readonly events: EventSubscribable<FieldEvents> = this.dispatcher;
}

class DataRecord implements Evented<RecordEvents> {
  private readonly dispatcher = new EventDispatcher<RecordEvents>();
  readonly events: EventSubscribable<RecordEvents> = this.dispatcher;
  private readonly fields = new Map<DataField, () => void>();

  add(field: DataField) {
    // 戻り値の関数を呼ぶと転送をやめる
    const off = relay(field.events, this.dispatcher, {
      change: {
        type: 'fieldChange',
        detail: (detail) => ({ field, ...detail }),
      },
    });
    this.fields.set(field, off);
  }

  remove(field: DataField) {
    this.fields.get(field)?.();
    this.fields.delete(field);
  }
}

record.events.on('change', ...); // レコード自身の変更
record.events.on('fieldChange', (event) => event.detail.field); // フィールドの変更
```

detail をそのまま渡せる場合は、転送先のイベント名だけを指定できます。

```ts
relay(field.events, this.dispatcher, { change: 'fieldValueChange' });
```

- 転送先で `preventDefault()` が呼ばれると、転送元のイベントでも `preventDefault()` が呼ばれ、転送元の `dispatch` が `false` を返します。
- 転送先のハンドラーの例外は、転送元の `dispatch` から投げられます。
- 転送先が抑止中の場合は、転送先のモードに従います（抑止中は `dispatch` が `true` を返すため、キャンセルは転送元に戻りません）。
- 親子の寿命は独立しているため、子を個別に `dispose` しても親には影響しません。

### 購読されているあいだだけ処理を動かす

コンストラクターの `activate` に、イベント名ごとの有効化の処理を指定します。有効化の処理はイベントの最初のハンドラーが登録されたときに呼ばれ、返した関数は最後のハンドラーが削除されたときに呼ばれます。\
DOM のリスナーや `ResizeObserver` などを、購読されているあいだだけ動かす場合に使います。

```ts
type ViewportEvents = {
  resize: { width: number; height: number };
};

const getSize = () => ({ width: innerWidth, height: innerHeight });

const events = new EventDispatcher<ViewportEvents>({
  activate: {
    resize: ({ dispatch }) => {
      const listener = () => dispatch('resize', getSize());
      window.addEventListener('resize', listener);
      return () => window.removeEventListener('resize', listener);
    },
  },
});

const off = events.on('resize', (event) => console.log(event.detail)); // window の監視を始める
off(); // window の監視をやめる
```

- 有効化の処理は、ハンドラーを登録してから呼ばれます。有効化の処理の中で `dispatch` すると、登録したハンドラーが受け取れます（初期値を渡す場合など）。
- `off`・`on` の戻り値の関数・`signal`・`once`・`dispose` のどの方法で削除しても、最後のハンドラーがなくなった時点で無効化されます。`dispatch` の実行中に削除された場合も、その場で無効化されます。
- 削除した直後に登録し直すと、無効化と有効化が続けて呼ばれます。
- `activate` はコンストラクターでしか指定できないため、インスタンスを共有した子からは変更できません。
- 有効かどうかは `hasHandlers(type)` で確認できます。

### 破棄

```ts
events.dispose();

// using 構文にも対応
{
  using events = new EventDispatcher<TodoEvents>();
  // スコープを抜けると dispose される
}
```

## API

### `EventDispatcher<M>`

| メソッド                        | 説明                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `new EventDispatcher(options?)` | インスタンスを作る。`options` で有効化の処理を指定できる                                                    |
| `on(type, handler, options?)`   | ハンドラーを登録し、削除する関数を返す。`type` は配列で複数指定できる。同一ハンドラーの重複登録は無視される |
| `off(type, options?)`           | ハンドラーを削除する。`options` を省略するとそのイベントのハンドラーをすべて削除する                        |
| `off(options)`                  | 全イベントから、指定のハンドラーまたはオーナーのハンドラーを削除する                                        |
| `dispatch(type, detail?)`       | イベントを発火する。`preventDefault()` が呼ばれた場合は `false` を返す（抑止中は常に `true`）               |
| `hasHandlers(type)`             | イベントにハンドラーが登録されているかどうかを返す                                                          |
| `suspend(mode?)`                | イベントの発火を抑止する                                                                                    |
| `resume()`                      | 抑止を解除し、溜めていたイベントを発火する                                                                  |
| `suspendDuring(fn, mode?)`      | 関数の実行中だけ抑止し、関数の戻り値を返す                                                                  |
| `dispose()`                     | 全ハンドラーと溜めていたイベントを削除し、抑止を解除する                                                    |

#### `constructor`

```ts
new EventDispatcher<M>(options?: EventDispatcherOptions<M>)
```

インスタンスを作ります。

| オプション  | 型                                          | 説明                                                                                                                           |
| ----------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `activate?` | `{ [K in keyof M]?: EventActivator<M, K> }` | イベント名ごとの有効化の処理。最初のハンドラーが登録されたときに呼ばれ、返した関数は最後のハンドラーが削除されたときに呼ばれる |

有効化の処理は、次のプロパティを持つオブジェクトを受け取ります。

| プロパティ | 型                  | 説明                                    |
| ---------- | ------------------- | --------------------------------------- |
| `type`     | `K`                 | 有効になったイベント名                  |
| `dispatch` | `dispatch` と同じ型 | イベントを発火する（`dispatch` と同じ） |

#### `on`

```ts
on<K extends keyof M>(
  type: K | readonly K[],
  handler: EventHandler<M, K>,
  options?: OnHandlerOptions,
): () => void
```

ハンドラーを登録し、削除する関数を返します。同一イベントへの同一ハンドラーの重複登録は無視されます。

| 引数       | 型                   | 説明                             |
| ---------- | -------------------- | -------------------------------- |
| `type`     | `K \| readonly K[]`  | イベント名。配列で複数指定できる |
| `handler`  | `EventHandler<M, K>` | イベントハンドラー               |
| `options?` | `OnHandlerOptions`   | 下記のオプション                 |

| オプション | 型            | 説明                                                                 |
| ---------- | ------------- | -------------------------------------------------------------------- |
| `owner?`   | `any`         | ハンドラーのオーナー。`off({ owner })` でまとめて削除できる          |
| `once?`    | `boolean`     | 一度呼ばれたら削除する。複数のイベント名を指定した場合は合わせて一度 |
| `signal?`  | `AbortSignal` | abort されたらハンドラーを削除する                                   |

#### `off`

```ts
off<K extends keyof M>(type: K | readonly K[], options?: OffHandlerOptions): void
off(options: OffHandlerOptions): void
```

ハンドラーを削除します。

| 引数       | 型                                       | 説明                                                                                                                                                                                    |
| ---------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`     | `K \| readonly K[]`                      | イベント名。配列で複数指定できる。省略した場合は全イベントが対象になる                                                                                                                  |
| `options?` | `{ handler: EventHandler } \| { owner }` | `handler` を指定するとそのハンドラーのみ、`owner` を指定するとそのオーナーのハンドラーを削除する。`type` を指定した場合のみ省略でき、省略するとそのイベントのハンドラーをすべて削除する |

#### `dispatch`

```ts
dispatch<K extends keyof M>(type: K, detail?: M[K]): boolean
```

イベントを発火します。いずれかのハンドラーで `preventDefault()` が呼ばれた場合は `false` を返します。抑止中は常に `true` を返します。

| 引数      | 型     | 説明                                                                  |
| --------- | ------ | --------------------------------------------------------------------- |
| `type`    | `K`    | イベント名                                                            |
| `detail?` | `M[K]` | イベントのデータ。detail の型が `void` のイベントの場合のみ省略できる |

#### `hasHandlers`

```ts
hasHandlers(type: keyof M): boolean
```

イベントにハンドラーが登録されているかどうかを返します。detail の生成に手間がかかる場合に、発火を省くために使います。抑止中かどうかは考慮しません。

```ts
if (events.hasHandlers('change')) {
  events.dispatch('change', createDetail());
}
```

#### `suspend`

```ts
suspend(mode?: SuspendMode): void
```

イベントの発火を抑止します。`mode` で抑止中のイベントの扱いを指定します（既定値は `'ignore'`）。モードについては[イベントの抑止](#イベントの抑止)を参照してください。\
入れ子で呼んだ場合は同じ回数 `resume` するまで抑止が続き、モードは一番外側の指定に従います。

#### `resume`

```ts
resume(): void
```

抑止を解除します。抑止が完全に解除された時点で、溜めていたイベントを溜めた順に発火します。

#### `suspendDuring`

```ts
suspendDuring<R>(fn: SyncFunction<R>, mode?: SuspendMode): R
```

`fn` の実行中だけイベントの発火を抑止し、`fn` の戻り値を返します。`fn` は同期的に実行され、例外が発生しても抑止は解除されます。Promise を返す関数は型エラーになります。\
`fn` の例外に加えて、抑止の解除時に溜めていたイベントのハンドラーでも例外が発生した場合は、`fn` の例外を先頭にして `AggregateError` にまとめて投げます。

#### `dispose`

```ts
dispose(): void
```

全ハンドラーと溜めていたイベントを削除し、抑止を解除します。有効になっているイベントの無効化の処理もすべて呼びます。`using` 構文でスコープを抜けたときにも呼ばれます。\
`dispose` のあとも、再び `on` で登録して使えます。

#### ハンドラーが受け取るイベント

| プロパティ                   | 型        | 説明                                   |
| ---------------------------- | --------- | -------------------------------------- |
| `type`                       | `K`       | イベント名                             |
| `detail`                     | `M[K]`    | `dispatch` で渡されたデータ            |
| `defaultPrevented`           | `boolean` | `preventDefault()` が呼ばれたかどうか  |
| `preventDefault()`           | `void`    | イベントをキャンセルする               |
| `stopImmediatePropagation()` | `void`    | 残りのハンドラーを実行しないようにする |

標準の `Event` と同じ名前・同じ意味のメンバーだけを持ちます。バブリングがないため、`stopPropagation()` や `target` などはありません。

#### 例外の扱い

ハンドラーで例外が発生しても、残りのハンドラーは実行されます。例外はすべてのハンドラーの実行後に投げられ、複数の場合は `AggregateError` にまとめられます。

例外が投げられた場合、`dispatch` は戻り値を返さないため、`preventDefault()` が呼ばれたかどうかは分かりません。キャンセル可能なイベントで例外を `catch` して処理を続ける場合は、キャンセルされたかどうかを判断できない点に注意してください。

```ts
try {
  if (events.dispatch('beforeSubmit', { values })) {
    submit(values);
  }
} catch (error) {
  // ここでは、いずれかのハンドラーが preventDefault() を呼んだかどうか分からない
}
```

有効化・無効化の処理で発生した例外は、次のように扱います。

| 発生した場所                                       | 扱い                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 有効化の処理                                       | `on` から投げる。登録は取り消され、同じ `on` で先に有効化されたイベントも無効化される        |
| `off`・`on` の戻り値の関数・`dispose` による無効化 | すべてのハンドラーを削除してから投げる                                                       |
| `dispatch` の実行中の無効化（`once` など）         | ハンドラーの例外と同じく、すべてのハンドラーの実行後に投げる                                 |
| `signal` の abort による無効化                     | `AbortSignal` のリスナーの中で投げられる（ブラウザーでは `window.onerror` などに報告される） |

### `relay`

```ts
relay<S extends EventMap, T extends EventMap>(
  source: EventSubscribable<S>,
  target: EventDispatcherLike<T>,
  map: RelayMap<S, T>,
  options?: RelayOptions,
): () => void
```

転送元のイベントを、転送先のイベントとして発火し直します。転送をやめる関数を返します。\
転送先で `preventDefault()` が呼ばれた場合は、転送元のイベントでも `preventDefault()` を呼びます。

| 引数       | 型                       | 説明                                           |
| ---------- | ------------------------ | ---------------------------------------------- |
| `source`   | `EventSubscribable<S>`   | 転送元                                         |
| `target`   | `EventDispatcherLike<T>` | 転送先                                         |
| `map`      | `RelayMap<S, T>`         | 転送元のイベント名ごとの転送先の指定           |
| `options?` | `RelayOptions`           | 下記のオプション。転送元の `on` にそのまま渡す |

`map` の値には、次のどちらかを指定します。

| 値                 | 説明                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `'eventName'`      | 転送先のイベント名。detail をそのまま渡す。転送元の detail を転送先の detail に代入できる場合のみ指定できる |
| `{ type, detail }` | 転送先のイベント名と、転送元の detail とイベントから転送先の detail を作る関数 `(detail, event) => ...`     |

| オプション | 型            | 説明                                                                       |
| ---------- | ------------- | -------------------------------------------------------------------------- |
| `owner?`   | `any`         | 転送元のハンドラーのオーナー。転送元の `off({ owner })` で転送をやめられる |
| `signal?`  | `AbortSignal` | abort されたら転送をやめる                                                 |

転送元の `on` で例外が発生した場合（有効化の処理の例外など）は、登録済みの転送をやめてから投げます。転送をやめるときに例外が発生した場合も、すべての転送をやめてから投げます。

### 型

| 型                            | 説明                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `EventMap`                    | イベントマップの基本型                                                           |
| `EventInfo<M, K>`             | ハンドラーが受け取るイベント                                                     |
| `EventHandler<M, K>`          | イベントハンドラー                                                               |
| `OnHandlerOptions`            | `on` のオプション                                                                |
| `OffHandlerOptions`           | `off` のオプション                                                               |
| `EventSubscribable<M>`        | 購読（`on` / `off`）だけのインターフェイス。外部に公開する型に使う               |
| `EventDispatcherLike<M>`      | 購読と発火・抑止のインターフェイス（`dispose` は含まない）。子が受け取る型に使う |
| `Evented<M>`                  | 購読用の `events` プロパティを持つクラスのインターフェイス                       |
| `SuspendMode`                 | 抑止中のイベントの扱い（`'ignore' \| 'queue' \| 'latest'`）                      |
| `SyncFunction<R>`             | `suspendDuring` に渡す同期的な関数（Promise を返す関数は型エラー）               |
| `EventDispatcherOptions<M>`   | `EventDispatcher` のコンストラクターのオプション                                 |
| `EventActivator<M, K>`        | イベントの有効化の処理。無効化の処理を返せる                                     |
| `EventActivatorContext<M, K>` | 有効化の処理が受け取る情報                                                       |
| `RelayMap<S, T>`              | `relay` の転送元のイベント名ごとの転送先の指定                                   |
| `RelayTarget<S, T, K>`        | `relay` の転送先の指定（イベント名、または `{ type, detail }`）                  |
| `RelayOptions`                | `relay` のオプション                                                             |

## ライセンス

MIT
