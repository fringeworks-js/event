# @fringeworks/event

`@fringeworks/event` はシンプルなイベント処理のための、誰かにとっては便利なライブラリです。\
型安全なイベントの登録・発火に加えて、インスタンスの親子間での共有、イベントの抑止とまとめての発火、キャンセル可能なイベントを提供します。

**[English README is available here](./README.md)**

## 特徴

- 型安全: イベント名ごとに detail の型が決まり、複数のイベントをまとめて購読しても `type` で型を絞り込めます。
- インスタンスの共有: 親が持つ `EventDispatcher` を子に渡すだけで、子のイベントを親の購読者が受け取れます。
- 抑止: イベントの発火を一時的に止め、抑止中のイベントを無視する・すべて発火する・最後の1件だけ発火するから選べます。
- キャンセル: ハンドラーで `preventDefault()` を呼ぶと `dispatch` が `false` を返します。
- 標準 API との親和性: `AbortSignal` による解除と、`using` 構文による破棄に対応しています。

## インストール

```sh
npm install @fringeworks/event
```

TypeScript で使う場合は 5.2 以上が必要です。

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

```ts
import {
  EventDispatcher,
  type EventDispatcherLike,
  type Evented,
} from '@fringeworks/event';

type ToolbarEvents = {
  click: { button: string };
};

type GridEvents = ToolbarEvents & {
  select: { row: number };
};

class Toolbar implements Evented<ToolbarEvents> {
  constructor(readonly events: EventDispatcherLike<ToolbarEvents>) {}
}

class Grid implements Evented<GridEvents> {
  readonly events = new EventDispatcher<GridEvents>();
  readonly toolbar = new Toolbar(this.events);
}

const grid = new Grid();
grid.events.on('click', (event) => console.log(event.detail.button));
```

共有しているインスタンスの `dispose` は、インスタンスを作った側（上の例では `Grid`）だけが呼ぶようにしてください。受け取った側（`Toolbar`）が `dispose` を呼ぶと、親や他の子の購読もすべて削除されます。\
受け取った側が自分の登録したハンドラーだけを削除したい場合は、登録時に `owner` を指定して `off({ owner: this })` を使います。

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

| メソッド                      | 説明                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `on(type, handler, options?)` | ハンドラーを登録し、削除する関数を返す。`type` は配列で複数指定できる。同一ハンドラーの重複登録は無視される |
| `off(type, options?)`         | ハンドラーを削除する。`options` を省略するとそのイベントのハンドラーをすべて削除する                        |
| `off(options)`                | 全イベントから、指定のハンドラーまたはオーナーのハンドラーを削除する                                        |
| `dispatch(type, detail?)`     | イベントを発火する。`preventDefault()` が呼ばれた場合は `false` を返す（抑止中は常に `true`）               |
| `suspend(mode?)`              | イベントの発火を抑止する                                                                                    |
| `resume()`                    | 抑止を解除し、溜めていたイベントを発火する                                                                  |
| `suspendDuring(fn, mode?)`    | 関数の実行中だけ抑止し、関数の戻り値を返す                                                                  |
| `dispose()`                   | 全ハンドラーと溜めていたイベントを削除し、抑止を解除する                                                    |

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

抑止を解除します。抑止が完全に解除された時点で、溜めていたイベントを発火します。

#### `suspendDuring`

```ts
suspendDuring<R>(fn: () => R, mode?: SuspendMode): R
```

`fn` の実行中だけイベントの発火を抑止し、`fn` の戻り値を返します。`fn` は同期的に実行され、例外が発生しても抑止は解除されます。Promise を返す関数は型エラーになります。

#### `dispose`

```ts
dispose(): void
```

全ハンドラーと溜めていたイベントを削除し、抑止を解除します。`using` 構文でスコープを抜けたときにも呼ばれます。

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

### 型

| 型                       | 説明                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `EventMap`               | イベントマップの基本型                                      |
| `EventInfo<M, K>`        | ハンドラーが受け取るイベント                                |
| `EventHandler<M, K>`     | イベントハンドラー                                          |
| `OnHandlerOptions`       | `on` のオプション                                           |
| `OffHandlerOptions`      | `off` のオプション                                          |
| `EventDispatcherLike<M>` | `EventDispatcher` のインターフェイス。子が受け取る型に使う  |
| `Evented<M>`             | `events` プロパティを持つクラスのインターフェイス           |
| `SuspendMode`            | 抑止中のイベントの扱い（`'ignore' \| 'queue' \| 'latest'`） |

## ライセンス

MIT
